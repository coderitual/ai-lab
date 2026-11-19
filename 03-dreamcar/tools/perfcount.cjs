// Dev tool: what a frame costs, counted. This machine has no GPU, so nothing here is a time: it is what a GPU
// would be asked to do, per pass, at moments of the autopilot's run.
//
//   node tools/perfcount.cjs --url "http://localhost:4190/?manual&auto&ap&seed=1&time=day&q=medium&dpr=0.25"
//        --times 8,26,36,56          page seconds to count at (the lap clock is about 5.2 s less)
//        --levels 0,5                levels of the quality ladder to count at each moment (default: 0)
//        --frames 4                  frames averaged at each (a probe face is drawn every 2nd or 4th)
//        --w 402 --h 874 --mobile    the page's shape (counts depend on the shape, not on the size: use a small
//                                    --dpr in the address so that software WebGL draws quickly)
//        --out counts.json           everything, per pass and per object
//
// Per moment and level it prints, for one frame on average: draw calls and triangles of the whole frame and of
// each pass (the scene, the sun's shadow map, the car's probe faces, the wet road's mirror, the full-screen passes),
// the trees drawn in each form and those that cast shadows, and how many layers of alpha-tested tree cards cover
// the picture on average (the area of every tree card drawn, as seen, over the picture's area: an upper bound on
// the forest's overdraw before depth rejects any of it), and the area of the shadow-casting trees' cards in the
// sun's shadow map, in texels (each texel of a card runs the alpha test). Once per page: the full-screen passes' targets, and the
// length of the fragment shaders of the ground, the road, the sea and the trees as three.js compiled them (lines of
// GLSL after the preprocessor's includes, and texture lookups written in the source).
//
// How passes are told apart: renderer.render and renderer.shadowMap.render are wrapped in the page and
// renderBufferDirect labels each draw by the pass under way (docs/techniques.md, "What each pass draws").
//
// Requires Playwright to be available to Node (it is not a project dependency).

const fs = require('fs');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i];
  }
  return args;
}

(async () => {
  const a = parseArgs(process.argv);
  if (!a.url) {
    console.log('usage: node tools/perfcount.cjs --url URL [--times 8,26,36,56] [--levels 0] [--frames 4] [--w 402 --h 874 --mobile] [--out file.json]');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({
    viewport: { width: parseInt(a.w || 402, 10), height: parseInt(a.h || 874, 10) },
    deviceScaleFactor: 1,
    isMobile: !!a.mobile,
    hasTouch: !!a.mobile,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(1800000);
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  const started = Date.now();
  await page.goto(a.url, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 1800000 });
  console.log(`ready in ${Math.round((Date.now() - started) / 1000)} s`);

  // label every draw by its pass
  await page.evaluate(() => {
    const d = window.__dreamcar;
    const r = d.engine.renderer;
    const world = d.game.world;
    const M = (window.__count = { pass: 'other', acc: {} });
    const top = (o) => {
      const path = [];
      let x = o;
      while (x && x.parent && x.parent !== world.scene) {
        if (x.name) path.push(x.name);
        x = x.parent;
      }
      const t = x ? x.name || x.type : '?';
      return `${t}/${o.name || path[1] || path[0] || o.type}`;
    };
    const direct = r.renderBufferDirect;
    r.renderBufferDirect = function (camera, scene, geometry, material, object) {
      const t0 = r.info.render.triangles;
      const c0 = r.info.render.calls;
      direct.apply(this, arguments);
      const acc = (M.acc[M.pass] ||= { calls: 0, tris: 0, by: {} });
      const tris = r.info.render.triangles - t0;
      acc.calls += r.info.render.calls - c0;
      acc.tris += tris;
      const label = M.pass === 'post' ? 'post' : top(object);
      const by = (acc.by[label] ||= [0, 0]);
      by[0] += r.info.render.calls - c0;
      by[1] += tris;
    };
    const shadows = r.shadowMap.render;
    r.shadowMap.render = function () {
      const p = M.pass;
      M.pass = 'shadow';
      shadows.apply(this, arguments);
      M.pass = p;
    };
    const render = r.render;
    r.render = function (scene) {
      const t = r.getRenderTarget();
      const p = M.pass;
      M.pass = t && t.isWebGLCubeRenderTarget ? 'probe' : world.mirror && t === world.mirror.target ? 'mirror' : scene === world.scene ? 'scene' : 'post';
      render.apply(this, arguments);
      M.pass = p;
    };

    // the area of a tree model's triangles (m², at scale 1), once per geometry
    const areas = new Map();
    const areaOf = (g) => {
      if (areas.has(g)) return areas.get(g);
      const p = g.attributes.position;
      const ix = g.index;
      const n = ix ? ix.count : p.count;
      let sum = 0;
      const v = (i) => {
        const k = ix ? ix.getX(i) : i;
        return [p.getX(k), p.getY(k), p.getZ(k)];
      };
      for (let i = 0; i < n; i += 3) {
        const A = v(i);
        const B = v(i + 1);
        const C = v(i + 2);
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        const w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        sum += 0.5 * Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
      }
      areas.set(g, sum);
      return sum;
    };
    /**
     * Layers of tree cards over the picture: every instance drawn by the view, its triangles' area times its scale
     * squared, halved (a card is seen at a slant on average; an impostor faces the lens: not halved), projected by
     * its distance, over the picture's area.
     */
    window.__overdraw = () => {
      const view = d.game.views[0];
      const cam = view.camera;
      const eye = cam.getWorldPosition(new cam.position.constructor());
      const focal = (0.5 * view.rect.h) / Math.tan((cam.fov * Math.PI) / 360);
      const out = {};
      let total = 0;
      for (const m of world.forest.group.children) {
        if (!m.visible || !m.isInstancedMesh || m.layers.mask !== 1) continue;
        const n = m.userData.main ?? m.count;
        const e = m.instanceMatrix.array;
        const facing = /impostor/.test(m.name) ? 1 : 0.5;
        const area = areaOf(m.geometry);
        let px = 0;
        for (let i = 0; i < n; i++) {
          const o = i * 16;
          const s2 = e[o] * e[o] + e[o + 1] * e[o + 1] + e[o + 2] * e[o + 2];
          const dist = Math.max(2, Math.hypot(e[o + 12] - eye.x, e[o + 13] - eye.y, e[o + 14] - eye.z));
          px += area * s2 * facing * (focal / dist) ** 2;
        }
        const kind = m.name.replace(/^forest-/, '').replace(/-.*/, '');
        out[kind] = (out[kind] || 0) + px / (view.rect.w * view.rect.h);
        total += px / (view.rect.w * view.rect.h);
      }
      for (const k in out) out[k] = Math.round(out[k] * 100) / 100;
      out.total = Math.round(total * 100) / 100;
      return out;
    };
    /**
     * What the trees that cast shadows cost the sun's map: each is one card turned to the light, and every texel of
     * the card runs the alpha test. Its area in the map's texels (its width across the light's view by its height up
     * it; cards that hang over the map's edge are counted whole, so this is an upper bound).
     */
    window.__casterFill = () => {
      let light = null;
      world.scene.traverse((o) => {
        if (o.isDirectionalLight && o.castShadow) light = o;
      });
      const box = world.shadowBox;
      const mesh = world.forest.group.children.find((m) => m.name === 'forest-casters');
      if (!light || !box || !box.on || !mesh || !world.forest.atlas) return null;
      const size = light.shadow.mapSize.x;
      const tx = (2 * box.halfX) / size;
      const ty = (2 * box.halfY) / light.shadow.mapSize.y;
      const up = Math.sqrt(Math.max(0, 1 - box.dir.y * box.dir.y)); // a metre of height, seen from the light
      const e = mesh.instanceMatrix.array;
      const imp = mesh.geometry.attributes.aImp.array;
      const boxes = world.forest.atlas.boxes;
      let texels = 0;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16;
        const b = boxes[Math.round(imp[i * 2])];
        if (!b) continue;
        const sx = Math.hypot(e[o], e[o + 1], e[o + 2]);
        const sy = Math.hypot(e[o + 4], e[o + 5], e[o + 6]);
        texels += ((2 * b.x * sx) / tx) * (((b.z - b.y) * sy * up) / ty);
      }
      return { map: size, casters: mesh.count, megatexels: Math.round(texels / 1e4) / 100, mapMegatexels: Math.round((size * light.shadow.mapSize.y) / 1e4) / 100 };
    };
  });

  const times = String(a.times || '8,26,36,56').split(',').map(Number);
  const levels = String(a.levels || '0').split(',').map(Number);
  const frames = parseInt(a.frames || 4, 10);
  const result = [];
  let now = await page.evaluate('window.__dreamcar.engine.simTime');
  for (const T of times) {
    for (const level of levels) {
      const r = await page.evaluate(
        ({ T, now, frames, level }) => {
          const d = window.__dreamcar;
          if (T > now) d.skip(T - now);
          if (d.engine.setQualityStep) d.engine.setQualityStep(level);
          // two frames for the level to take (targets, the forest's lists), then the ones counted
          d.advance(2 / 60);
          const M = window.__count;
          M.acc = {};
          d.advance(frames / 60);
          const st = d.stats();
          const per = {};
          for (const [k, v] of Object.entries(M.acc)) {
            const by = Object.entries(v.by)
              .map(([l, [c, t]]) => [l, Math.round((c / frames) * 10) / 10, Math.round(t / frames)])
              .sort((x, y) => y[2] - x[2]);
            per[k] = { calls: Math.round((v.calls / frames) * 10) / 10, tris: Math.round(v.tris / frames), by: by.slice(0, 30) };
          }
          const f = d.game.world.stats.forest.view;
          return {
            T,
            level,
            now: d.engine.simTime,
            s: Math.round(d.state().drivers[0].s),
            kmh: Math.round(d.state().drivers[0].kmh),
            shed: st.quality ? st.quality.shed : [],
            scale: st.renderScale,
            per,
            forest: { full: f.full, reduced: f.reduced, impostors: f.impostors, floor: f.floor, casters: f.casters, castersUnseen: f.castersUnseen || 0, triangles: f.triangles, casterTriangles: f.casterTriangles },
            overdraw: window.__overdraw(),
            casterFill: window.__casterFill(),
            passes: st.pipeline.passes,
            pipeline: st.pipeline,
            tier: st.tier,
            time: st.time,
          };
        },
        { T, now, frames, level },
      );
      now = r.now;
      result.push(r);
      const k = (n) => `${(n / 1000).toFixed(0)} k`;
      const total = Object.values(r.per).reduce((x, v) => [x[0] + v.calls, x[1] + v.tris], [0, 0]);
      const pass = (name) => (r.per[name] ? `${name} ${Math.round(r.per[name].calls)} / ${k(r.per[name].tris)}` : `${name} -`);
      console.log(
        `${r.tier} ${r.time} t=${T} (s ${r.s} m, ${r.kmh} km/h) level ${level}${r.shed.length ? ` [${r.shed.join(' ')}${r.scale < 1 ? ` x${r.scale}` : ''}]` : ''}: ` +
          `${Math.round(total[0])} calls, ${k(total[1])} triangles | ${['scene', 'shadow', 'probe', 'mirror'].map(pass).join(' | ')} | post ${Math.round(r.per.post?.calls || 0)} passes` +
          ` | trees ${r.forest.full} full, ${r.forest.reduced} reduced, ${r.forest.impostors} impostors, ${r.forest.floor} floor patches, ${r.forest.casters} casters${r.forest.castersUnseen ? ` (${r.forest.castersUnseen} more left out: their shadows are out of sight)` : ''}` +
          ` | tree-card layers ${r.overdraw.total} (${Object.entries(r.overdraw).filter(([n]) => n !== 'total').map(([n, v]) => `${n} ${v}`).join(', ')})` +
          (r.casterFill ? ` | caster cards in the ${r.casterFill.map} shadow map: ${r.casterFill.megatexels} M texels (the map has ${r.casterFill.mapMegatexels} M)` : ''),
      );
    }
  }

  // the shaders, as compiled
  const shaders = await page.evaluate(() => {
    const d = window.__dreamcar;
    const r = d.engine.renderer;
    const gl = r.getContext();
    const world = d.game.world;
    const seen = new Map();
    world.scene.traverse((o) => {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      const program = r.properties.get(o.material).currentProgram;
      if (!program || seen.has(program.id)) return;
      let x = o;
      while (x.parent && x.parent !== world.scene) x = x.parent;
      const src = gl.getShaderSource(program.fragmentShader) || '';
      const code = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#'));
      seen.set(program.id, {
        of: `${x.name || x.type}/${o.name || o.material.name || o.material.type}`,
        lines: code.length,
        chars: src.length,
        lookups: (src.match(/\btexture(?:Lod|Grad|2D|Cube)?\s*\(/g) || []).length,
        samplers: (src.match(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler\w+\s+\w+/g) || []).length,
      });
    });
    return [...seen.values()].sort((x, y) => y.lines - x.lines);
  });
  console.log('\nfragment shaders as compiled (lines of code, texture lookups written, samplers declared), the longest first:');
  for (const s of shaders.slice(0, 16)) console.log(`  ${String(s.lines).padStart(5)} lines, ${String(s.lookups).padStart(3)} lookups, ${String(s.samplers).padStart(2)} samplers  ${s.of}`);
  const last = result[result.length - 1];
  if (last) console.log(`\npipeline (${last.tier}): ${JSON.stringify(last.pipeline)}`);
  if (problems.length) console.log(`\nproblems: ${[...new Set(problems)].slice(0, 6).join(' | ')}`);
  if (a.out) fs.writeFileSync(a.out, JSON.stringify({ url: a.url, problems, result, shaders }, null, 1));
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
