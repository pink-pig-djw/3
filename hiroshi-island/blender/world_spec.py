"""Hand-authored level description for chapter one: 溪谷 (the valley).

All coordinates are GAME coordinates in metres: x = east, z = south (towards
the viewer at the start), y = up. Blender scripts convert with common.to_game.
"""

# Stream centre line, upstream -> downstream.
# (x, z, water surface y, channel width, water depth)
STREAM = [
    (0.0, -36.0, 6.00, 3.2, 0.35),   # inside the culvert tunnel
    (0.0, -24.0, 6.00, 3.4, 0.35),   # culvert mouth
    (-1.0, -18.0, 5.88, 3.8, 0.42),
    (-3.0, -12.0, 5.76, 4.2, 0.45),
    (-2.8, -7.0, 5.66, 4.0, 0.25),   # cascade 1 (lip)
    (-2.0, -5.2, 5.16, 3.6, 0.55),   # cascade 1 (plunge)
    (0.5, 0.0, 5.08, 4.6, 0.45),
    (2.5, 5.0, 5.00, 4.4, 0.25),     # cascade 2 (lip)
    (2.6, 6.6, 4.62, 4.0, 0.50),     # cascade 2 (plunge)
    (1.0, 12.0, 4.54, 5.0, 0.45),
    (-2.5, 18.0, 4.46, 5.4, 0.40),
    (-4.5, 24.0, 4.38, 5.0, 0.30),   # stepping stones
    (-3.0, 31.0, 4.30, 5.6, 0.50),
    (0.5, 37.0, 4.22, 7.5, 0.90),
    (3.0, 45.0, 4.15, 14.0, 1.90),   # the pool (深潭)
    (4.0, 52.0, 4.15, 10.0, 1.30),
    (6.0, 57.0, 4.12, 4.0, 0.30),    # pool outlet lip
    (6.5, 58.6, 3.00, 3.6, 0.80),    # small fall
    (5.0, 68.0, 2.80, 4.4, 0.45),
    (0.5, 82.0, 2.40, 4.8, 0.45),
    (-4.0, 96.0, 2.00, 5.0, 0.45),
    (-6.0, 112.0, 1.50, 5.0, 0.45),
    (-6.5, 132.0, 0.90, 5.0, 0.45),
]

# Culvert (stone arch) wall
CULVERT = dict(x=0.0, z=-24.5, top=10.2, half_width=9.0, thickness=1.2, arch_radius=1.75,
               spring=6.05, tunnel_depth=11.0)

# Plateau road on top of the culvert embankment
ROAD = dict(z0=-30.5, z1=-25.6, y=10.2)

# The house (小屋). Floor height is the top of the raised wooden floor.
HOUSE = dict(x=11.5, z=-34.0, yaw_deg=-18.0, ground=10.45, floor=11.15, w=6.4, d=4.8)

# Wooden deck with bench on the west bank
DECK = dict(x=-12.8, z=18.0, yaw_deg=96.0, w=4.4, d=3.2, height=0.55)

# Footpaths (x, z). East path runs from the house to the stepping stones.
PATH_EAST = [
    (8.6, -31.0), (9.4, -28.4), (9.9, -25.8),     # house front -> stair top
    (10.3, -22.4), (11.0, -16.0), (11.2, -10.0), (10.0, -1.0), (9.0, 8.0),
    (7.6, 15.0), (4.6, 21.5), (2.0, 23.6),
]
STAIRS = dict(top=(9.9, -25.8), bottom=(10.3, -22.4), steps=8)
STEPPING_STONES = [(1.0, 24.4), (-0.6, 24.9), (-2.2, 24.4), (-3.8, 24.9), (-5.4, 24.3),
                   (-7.0, 24.7), (-8.6, 24.2)]
PATH_WEST = [(-10.2, 24.0), (-12.0, 21.6), (-14.6, 26.0), (-14.8, 33.0), (-12.5, 40.0), (-9.0, 46.5)]
ROAD_PATH = [(-34.0, -28.2), (-12.0, -28.0), (0.0, -27.9), (8.0, -27.8), (9.9, -27.2)]

# Where the player starts and what they look at
START = dict(x=-9.2, z=16.4, yaw_deg=8.0, pitch_deg=-2.0)

# Hero trees: (x, z, variant, scale, yaw)
HERO_TREES = [
    (-16.5, 13.5, 3, 1.15, 40.0),   # gnarled tree framing the deck (left of the start view)
    (15.5, 1.0, 0, 1.1, 120.0),
    (17.5, -38.5, 1, 1.0, 10.0),    # behind the house
    (-11.0, 54.0, 0, 1.2, 200.0),   # by the pool
    (13.0, 30.0, 2, 1.0, 300.0),
    (-7.5, -16.0, 1, 0.95, 80.0),
    (6.5, -14.5, 2, 0.9, 150.0),
]

# Lantern posts (x, z) along the paths
LANTERNS = [(9.3, -29.6), (10.6, -21.6), (11.6, -12.0), (10.6, -2.0), (9.2, 9.0), (6.6, 17.6),
            (-11.0, 23.2), (-14.9, 30.5), (-13.0, 39.0)]

PLAYABLE = dict(x0=-46.0, x1=46.0, z0=-44.0, z1=104.0)

# Terrain grid
TERRAIN = dict(size=256.0, res=513, far_size=2048.0, far_res=129)
