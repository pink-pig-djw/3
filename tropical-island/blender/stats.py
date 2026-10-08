"""Write assets/tex/stats.json: the mean linear colour of every base-colour texture.
The page divides a texture by its mean to use it as a detail layer over the scene's own colours.

    python stats.py ../assets/tex
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def main():
    d = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '../assets/tex')
    out = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith('_c.webp') or f.startswith('foliage'):
            continue
        a = np.asarray(Image.open(os.path.join(d, f)).convert('RGB'), np.float32) / 255
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        out[f[:-7]] = [round(float(x), 4) for x in lin.reshape(-1, 3).mean(0)]
    with open(os.path.join(d, 'stats.json'), 'w') as fh:
        json.dump(out, fh, indent=1)
    print(out)


if __name__ == '__main__':
    main()
