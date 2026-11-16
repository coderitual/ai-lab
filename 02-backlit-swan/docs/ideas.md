# Ideas

What to do next, roughly in order of value. Move a line out of here when it
is done.

## First, on a real device

1. **Run it on phones.** Nothing here has been seen on a device (see
   [tools.md](tools.md#what-has-not)). Frame rate per tier, whether the tier
   probe picks well, multisampled half-float targets on mobile GPUs, the
   gestures under a real thumb, how dark the picture reads in daylight, the
   adaptive render scale and the pixel budgets against a real GPU and a
   browser that caps its frame rate, Safari's page zoom and audio
   interruptions.
2. **Listen to the sound**, then decide whether it stays generated noise or
   wants more: a wing shuffle, a far-off bird, the bill's dabbling.

## Closer to the film

3. **A side-by-side tool**: the film's frame beside the build's at the same
   moment, with the measured sRGB targets of [design.md](design.md) sampled
   from both and printed. The measurements exist; the comparison is still
   done by eye.
4. **The body at the end, and the amber patch.** The body's edge hue, its
   warm region and its cap are now close to the film at 0.3 s and 7.5 s
   (measured per pixel: warm median 221, 209, 166 against 220, 203, 163). Not
   done: at 10.5 s the build's flank is still too bright and blue (teal median
   70, 108, 97 against the film's 52, 64, 54), the film's soft edge is wider
   than the build's (0.22 to 0.24 against 0.12 to 0.13 of the body), and the
   saturated amber patch under the wing tip is not reproduced. The stand-in's
   wing edge (`proxyShapes`) and the closing of the plumage over the last
   third are the places to work.
5. **The neck's inside**: now dim neutral olive as in the film at 0.3 s (rows
   within about 5 codes). At 3.8 s the middle of the neck is still darker
   than the film's (55, 68, 48 against 69, 81, 62).
6. **The glow's skirt**, fitted in the film as four Gaussians (sigma 0.21 to
   1.7 % of the picture height): the pyramid's per-level weights have not
   been calibrated against those numbers by measurement. Measured at three
   to 96 pixels from the body's top the build is within about 4 codes of the
   film, so it was left alone; the thin rim on the neck is weaker (+9 against
   +16 at 3 px, peak 117 against 200).
   **Glints** are mixed after the last tuning: ring glints are fewer, the
   wake's more, the cluster round the bill slightly worse.
7. **The film's last second**: the bill stays where it is in the water while
   the body glides up to it. Here the neck shape is played back and the bill
   moves with the body by a few centimetres.
8. **The meadow's reflection**: olive-gold vertical stripes under fine ripple
   lines, the film's most saturated colour after the meadow itself.
9. **Mist**: the film's shaft of haze brightens and greens over the eleven
   seconds.

## More swan

10. **Preening**: the neck laid back along a wing, the bill working in the
    feathers.
11. **Paddling**: the faint surge of each stroke, a foot showing behind the
    tail when it turns sharply.
12. **A wing stretch and flap**: wings are a folded shape here; an opening
    wing needs feathers as geometry.
13. **A second swan**, or cygnets in line astern.

## More water

14. **Dispersion in the simulated field**: event rings spreading into trains
    of different wavelengths, as real ones do.
15. **Fine ripple round every disturbance**, not only round the swan.
16. **Specks that part round the hull** and gather in the wake.
17. **Rain**: the ripple field and the drops are already there.

## Housekeeping

18. **Split the bundle**: three.js and the scene in one 698 kB file (192 kB
    gzipped). The scene could load after the first paint.
19. **Fold the look into the URL**, so that a view with its sun and aperture
    can be shared as a link.
20. **Per-frame allocations in the swan**: `Swan.update` runs twice a step
    (once from `SwanMind._write`) and `writeProxies` and `proxyShapes` build
    array literals each time: about 6,600 small objects a second, harmless on
    a desktop, a little garbage on a phone.
