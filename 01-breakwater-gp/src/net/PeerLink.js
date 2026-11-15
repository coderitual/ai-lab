// A direct browser-to-browser link (WebRTC data channels) set up without any
// game server. The two browsers still have to tell each other how to connect,
// so the players carry that by hand, through any chat app:
//
//   host   createInvite()      -> invite code  -> friend
//   guest  acceptInvite(code)  -> reply code   -> back to the host
//   host   acceptReply(code)   -> connected
//
// Each code is the browser's session description (with its network candidates)
// compressed into text. Public STUN servers are used only to discover each
// side's public address; no game data passes through them. Without a relay
// (TURN) server some strict networks cannot connect at all.

const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const PREFIX = 'BW1';
const ICE_WAIT_MS = 3500;
const CONNECT_WAIT_MS = 25000;
const NO_ROUTE = 'The connection could not be made. One of you may be on a network that blocks direct links, or the page that made the reply was closed or reloaded. Try again with a fresh invite.';

export const rtcSupported = () => typeof RTCPeerConnection === 'function';

// ------------------------------------------------------------ code <-> SDP

const toBase64Url = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();
  // bad input fails the read below; these would only repeat that as unhandled rejections
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const DAMAGED = 'That code is incomplete or damaged. Copy all of it and try again.';

/** A short check word: catches a code cut short or altered on its way through a chat app. */
function checkWord(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36).padStart(7, '0');
}

/**
 * Session description -> compact text: BW1<c|u>.<data>.<check>
 * (c = deflated, u = plain; the check word is seven letters or digits, so the
 * code never ends in punctuation that a chat app might trim off a link).
 */
async function encodeDescription(desc) {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  let kind = 'u';
  let bytes = raw;
  if (typeof CompressionStream === 'function') {
    try {
      bytes = await pipe(raw, new CompressionStream('deflate-raw'));
      kind = 'c';
    } catch {
      /* keep the uncompressed form */
    }
  }
  const data = toBase64Url(bytes);
  return `${PREFIX}${kind}.${data}.${checkWord(data)}`;
}

/** Text (a bare code, an invite link, or a whole chat message containing one) -> session description. */
async function decodeDescription(text) {
  // chat apps wrap long strings and add words around them: drop the white space, then find the code
  const packed = String(text || '').replace(/\s+/g, '');
  const m = packed.match(/BW1([cu])\.([A-Za-z0-9_-]+)\.([a-z0-9]{7})/);
  if (!m) {
    throw new Error(/BW1[cu]\./.test(packed) ? DAMAGED : 'That does not look like a Breakwater GP code. Copy the whole thing and try again.');
  }
  if (checkWord(m[2]) !== m[3]) throw new Error(DAMAGED);
  let obj;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === 'c') {
      if (typeof DecompressionStream !== 'function') throw new Error('old browser');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    obj = JSON.parse(new TextDecoder().decode(bytes));
  } catch (err) {
    throw new Error(err && err.message === 'old browser' ? 'This browser is too old to read the code. Try a current Safari, Chrome, Edge or Firefox.' : DAMAGED);
  }
  if (!obj || typeof obj.s !== 'string' || (obj.t !== 'offer' && obj.t !== 'answer')) throw new Error(DAMAGED);
  return { type: obj.t, sdp: obj.s };
}

/** Resolve once the browser has listed its network candidates (or after a short wait). */
function iceGathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ICE_WAIT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// --------------------------------------------------------------- the link

export class PeerLink {
  /**
   * @param {{ onOpen?: () => void, onClose?: (reason: string, wasOpen: boolean) => void, onMessage?: (msg: any) => void }} handlers
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.isHost = false;
    this.open = false;
    this.closed = false;
    this.ctl = null; // reliable, ordered: handshake, start, clock
    this.state = null; // unreliable: position updates (a late one is worthless)

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.addEventListener('connectionstatechange', () => {
      clearTimeout(this._dropTimer);
      if (pc.connectionState === 'failed') {
        this._gone(this.open ? 'The connection was lost.' : NO_ROUTE);
      } else if (pc.connectionState === 'closed') {
        this._gone('The connection was lost.');
      } else if (pc.connectionState === 'disconnected') {
        // often a brief hiccup that heals by itself: only give up if it lasts
        this._dropTimer = setTimeout(() => pc.connectionState !== 'connected' && this._gone('The connection was lost.'), 6000);
      }
    });
    pc.addEventListener('datachannel', (e) => this._adopt(e.channel));
  }

  _adopt(channel) {
    if (channel.label === 'ctl') this.ctl = channel;
    else this.state = channel;
    channel.addEventListener('open', () => this._maybeOpen());
    channel.addEventListener('close', () => this._gone('The other player left.'));
    channel.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg && typeof msg === 'object' && this.handlers.onMessage) this.handlers.onMessage(msg);
    });
  }

  _maybeOpen() {
    if (this.open || !this.ctl || !this.state) return;
    if (this.ctl.readyState !== 'open' || this.state.readyState !== 'open') return;
    this.open = true;
    clearTimeout(this._connectTimer);
    if (this.handlers.onOpen) this.handlers.onOpen();
  }

  _gone(reason) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this._dropTimer);
    clearTimeout(this._connectTimer);
    const wasOpen = this.open;
    this.open = false;
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    if (this.handlers.onClose) this.handlers.onClose(reason, wasOpen);
  }

  /** Host, step 1: returns the invite code to send to the friend. */
  async createInvite() {
    this.isHost = true;
    this._adopt(this.pc.createDataChannel('ctl', { ordered: true }));
    this._adopt(this.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await iceGathered(this.pc);
    return encodeDescription(this.pc.localDescription);
  }

  /** Guest: takes the invite, returns the reply code to send back. */
  async acceptInvite(code) {
    const offer = await decodeDescription(code);
    if (offer.type !== 'offer') throw new Error('That is a reply code. Paste the invite your friend sent you.');
    await this.pc.setRemoteDescription(offer);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await iceGathered(this.pc);
    return encodeDescription(this.pc.localDescription);
  }

  /** Host, step 2: takes the friend's reply; the link opens shortly after. */
  async acceptReply(code) {
    const answer = await decodeDescription(code);
    if (answer.type !== 'answer') throw new Error('That is an invite, not a reply. Paste the reply code your friend sent back.');
    await this.pc.setRemoteDescription(answer);
    // browsers can take very long to give up by themselves
    this._connectTimer = setTimeout(() => !this.open && this._gone(NO_ROUTE), CONNECT_WAIT_MS);
  }

  /** Send a message. `reliable` ones are for things that must arrive. */
  send(msg, reliable = false) {
    const channel = reliable ? this.ctl : this.state;
    if (!this.open || !channel || channel.readyState !== 'open') return false;
    try {
      channel.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.send({ k: 'bye' }, true);
    this.handlers = {};
    this._gone('closed');
  }
}
