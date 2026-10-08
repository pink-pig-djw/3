"""Tileable textures for the stream surface (pure numpy, no Blender needed).

    water_ripples.webp   RGB = tangent normal of flow-stretched capillary ripples,
                          A is not used (webp keeps it small)
    water_foam.webp      R = bubbly foam, G = streaks along the flow, B = soft noise

The v axis of both textures runs along the flow.
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, "public", "assets", "textures")


def spectral(n, seed, kmin, kmax, beta, aniso=(1.0, 1.0)):
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n) * n
    FX, FY = np.meshgrid(fx, fx)
    k = np.sqrt((FX * aniso[0]) ** 2 + (FY * aniso[1]) ** 2)
    amp = np.where((k >= kmin) & (k <= kmax), 1.0 / np.maximum(k, 1e-6) ** beta, 0.0)
    amp[0, 0] = 0
    phase = rng.uniform(0, 2 * np.pi, (n, n))
    F = amp * np.exp(1j * phase)
    h = np.real(np.fft.ifft2(F))
    return h / (h.std() + 1e-9)


def normal_from_height(h, strength):
    gy, gx = np.gradient(h)
    # wrap-around gradients for seamless tiling
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / L, ny / L, nz / L], 2)


def save(arr, name, q=92):
    from PIL import Image

    a = np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(a, "RGB").save(os.path.join(TEX, name), "WEBP", quality=q, method=6)
    print("[water] wrote", name)


def main():
    n = 512
    # ripples: elongated along the flow (v), a mix of scales
    h = (spectral(n, 1, 3, 40, 1.6, aniso=(1.0, 0.55)) * 1.0
         + spectral(n, 2, 20, 140, 1.2, aniso=(1.0, 0.7)) * 0.35)
    N = normal_from_height(h, 0.9)
    save(N * 0.5 + 0.5, "water_ripples.webp")

    # foam: bubbles (worley) + flow streaks
    from scipy.spatial import cKDTree

    rng = np.random.default_rng(7)
    pts = rng.random((900, 2))
    tree = cKDTree(pts, boxsize=[1, 1])
    u = (np.arange(n) + 0.5) / n
    U, V = np.meshgrid(u, u)
    d, _ = tree.query(np.stack([U.ravel(), V.ravel()], 1), k=2)
    f1 = d[:, 0].reshape(n, n)
    f2 = d[:, 1].reshape(n, n)
    cells = np.clip((f2 - f1) * 60.0, 0, 1)  # bubble walls are bright
    cloud = spectral(n, 3, 2, 18, 1.2)
    bubbles = np.clip(cells * 0.8 + 0.25 * cloud, 0, 1) * np.clip(0.5 + 0.5 * cloud, 0, 1)
    streak = spectral(n, 4, 2, 60, 1.0, aniso=(1.0, 0.12))
    streak = np.clip(0.5 + 0.35 * streak, 0, 1)
    soft = np.clip(0.5 + 0.3 * spectral(n, 5, 1, 12, 1.5), 0, 1)
    save(np.stack([bubbles, streak, soft], 2), "water_foam.webp")


if __name__ == "__main__":
    main()
