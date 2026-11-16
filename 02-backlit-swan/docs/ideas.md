# Ideas

What to do next, roughly in order of value. Move a line out of here when it
is done.

## First, on a real device

1. **Run it on phones.** Nothing here has been seen on a device (see
   [tools.md](tools.md#what-has-not)). Frame rate per tier, whether the tier
   probe picks well, multisampled half-float targets on mobile GPUs, the
   gestures under a real thumb, how dark the picture reads in daylight.
2. **Listen to the sound**, then decide whether it stays generated noise or
   wants more: a wing shuffle, a far-off bird, the bill's dabbling.

## Closer to the film

3. **A side-by-side tool**: the film's frame beside the build's at the same
   moment, with the measured sRGB targets of [design.md](design.md) sampled
   from both and printed. The measurements exist; the comparison is still
   done by eye.
4. **The body's cream and teal.** The film's rear two thirds are teal with a
   soft diagonal edge and a wide cream cap along the top; the build's warm
   region is a little larger and more sharply bounded. The stand-in's wing
   edge (`proxyShapes`) and a second, diffuse share of transmitted light are
   the places to work.
5. **The neck's inside is olive in the film**, lighter toward the top; here
   it is darker and bluer.
6. **The glow's skirt**, fitted in the film as four Gaussians (sigma 0.21 to
   1.7 % of the picture height): the pyramid's per-level weights have not
   been calibrated against those numbers by measurement.
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

18. **Split the bundle**: three.js and the scene in one 690 kB file (190 kB
    gzipped). The scene could load after the first paint.
19. **Fold the look into the URL**, so that a view with its sun and aperture
    can be shared as a link.
