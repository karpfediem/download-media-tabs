import math

def clamp_radius(a: float, h: float, r: float) -> float:
    """
    Clamp the corner radius r so the fillets fit on each side.
    Triangle is isosceles with vertices:
      A(-a,0), B(a,0), C(0,h), with y increasing downward (SVG default).
    """
    L = math.hypot(a, h)  # equal side length
    theta_apex = 2 * math.atan2(a, h)
    theta_base = (math.pi - theta_apex) / 2

    # On each vertex, offset along both adjacent edges by d = r * cot(theta/2).
    # d must not exceed the length of either adjacent edge.
    rmax_A = math.tan(theta_base / 2) * min(2 * a, L)  # at A
    rmax_B = rmax_A                                     # at B (same)
    rmax_C = math.tan(theta_apex / 2) * L               # at C (apex)

    rmax = min(rmax_A, rmax_B, rmax_C)
    return min(r, rmax)

def rounded_triangle_points(a: float, h: float, r: float):
    """
    Return the tangent points for a rounded isosceles triangle and arc centers.
    Coordinates are y-down (SVG-like).
    Vertices: A(-a,0), B(a,0), C(0,h).
    """
    r = clamp_radius(a, h, r)
    L = math.hypot(a, h)

    # Angles
    theta_apex = 2 * math.atan2(a, h)
    theta_base = (math.pi - theta_apex) / 2

    # Tangent distances along edges from each vertex
    d_base = r / math.tan(theta_base / 2)
    d_apex = r / math.tan(theta_apex / 2)

    # Unit directions along edges from each vertex
    ux, uy = a / L, h / L

    # Base-left vertex A (-a,0)
    Ab = (-a + d_base, 0.0)                    # along AB from A
    As = (-a + ux * d_base,  uy * d_base)      # along AC from A

    # Base-right vertex B (a,0)
    Bb = (a - d_base, 0.0)                     # along BA from B
    Bs = (a - ux * d_base,  uy * d_base)       # along BC from B

    # Apex vertex C (0,h)
    Cr = (ux * d_apex,  h - uy * d_apex)       # along CB from C
    Cl = (-ux * d_apex, h - uy * d_apex)       # along CA from C

    # Arc centers (for completeness / diagnostics)
    def unit(vx, vy):
        L = math.hypot(vx, vy)
        return (vx / L, vy / L)

    # A: bisector of AB (→) and AC (ux,uy)
    tAB_A = (1.0, 0.0)
    tAC_A = (ux, uy)
    bisA = unit(tAB_A[0] + tAC_A[0], tAB_A[1] + tAC_A[1])
    centerA = (-a + bisA[0] * r / math.sin(theta_base / 2),
               0.0 + bisA[1] * r / math.sin(theta_base / 2))

    # B: bisector of BA (←) and BC (−ux,uy)
    tBA_B = (-1.0, 0.0)
    tBC_B = (-ux, uy)
    bisB = unit(tBA_B[0] + tBC_B[0], tBA_B[1] + tBC_B[1])
    centerB = (a + bisB[0] * r / math.sin(theta_base / 2),
               0.0 + bisB[1] * r / math.sin(theta_base / 2))

    # C: bisector of CA (−ux,−uy) and CB (ux,−uy)
    tCA_C = (-ux, -uy)
    tCB_C = (ux, -uy)
    bisC = unit(tCA_C[0] + tCB_C[0], tCA_C[1] + tCB_C[1])  # should be (0, -1)
    centerC = (0.0 + bisC[0] * r / math.sin(theta_apex / 2),
               h   + bisC[1] * r / math.sin(theta_apex / 2))

    return {
        "Ab": Ab, "As": As, "Bb": Bb, "Bs": Bs, "Cr": Cr, "Cl": Cl,
        "centerA": centerA, "centerB": centerB, "centerC": centerC,
        "theta_base": theta_base, "theta_apex": theta_apex,
        "d_base": d_base, "d_apex": d_apex, "r": r
    }

def svg_arc_sweep_flag(start, end, center, y_down=True) -> int:
    """
    Decide the SVG 'sweep-flag' (0 or 1) for a circular arc from start->end,
    given the arc center. Assumes the *short* arc (large-arc-flag=0).
    In SVG's default y-down coordinates, clockwise = sweep-flag 1.
    """
    v1 = (start[0] - center[0], start[1] - center[1])
    v2 = (end[0]   - center[0], end[1]   - center[1])
    cross_z = v1[0] * v2[1] - v1[1] * v2[0]  # >0 means CCW in y-up math coords
    if y_down:
        return 1 if cross_z > 0 else 0  # flip
    else:
        return 0 if cross_z > 0 else 1

def fmt(x: float) -> str:
    """Nicely format floats for SVG."""
    s = f"{x:.3f}"
    # trim trailing zeros and dot
    s = s.rstrip("0").rstrip(".") if "." in s else s
    if s == "-0": s = "0"
    return s

def rounded_triangle_svg_path(a: float, h: float, r: float, y_down: bool = True) -> str:
    """
    Build an SVG path for the rounded isosceles triangle (counterclockwise outline):
      Ab -> Bb (line)
      arc at B: Bb -> Bs
      line Bs -> Cr
      arc at C: Cr -> Cl
      line Cl -> As
      arc at A: As -> Ab
      close
    Uses rx=ry=r, large-arc-flag=0, computed sweep flags.
    """
    data = rounded_triangle_points(a, h, r)
    Ab, As, Bb, Bs, Cr, Cl = data["Ab"], data["As"], data["Bb"], data["Bs"], data["Cr"], data["Cl"]
    cA, cB, cC = data["centerA"], data["centerB"], data["centerC"]
    rr = data["r"]

    sf_B = svg_arc_sweep_flag(Bb, Bs, cB, y_down=y_down)
    sf_C = svg_arc_sweep_flag(Cr, Cl, cC, y_down=y_down)
    sf_A = svg_arc_sweep_flag(As, Ab, cA, y_down=y_down)

    path = []
    # Move to Ab
    path.append(f"M {fmt(Ab[0])} {fmt(Ab[1])}")
    # Base line to Bb
    path.append(f"L {fmt(Bb[0])} {fmt(Bb[1])}")
    # Arc around B
    path.append(f"A {fmt(rr)} {fmt(rr)} 0 0 {sf_B} {fmt(Bs[0])} {fmt(Bs[1])}")
    # Line up right edge to near apex
    path.append(f"L {fmt(Cr[0])} {fmt(Cr[1])}")
    # Arc around apex C
    path.append(f"A {fmt(rr)} {fmt(rr)} 0 0 {sf_C} {fmt(Cl[0])} {fmt(Cl[1])}")
    # Line down left edge
    path.append(f"L {fmt(As[0])} {fmt(As[1])}")
    # Arc around A, back to Ab
    path.append(f"A {fmt(rr)} {fmt(rr)} 0 0 {sf_A} {fmt(Ab[0])} {fmt(Ab[1])}")
    # Close
    path.append("Z")
    return " ".join(path), data

if __name__ == "__main__":
    # PARAMETERS (edit these)
    a = 96.0    # half of the base width
    h = 100.0   # height (apex y, with y-down)
    r = 12.0    # corner radius

    path_d, geom = rounded_triangle_svg_path(a, h, r, y_down=True)
    print("# Tangent distances (d_base, d_apex) and side length L")
    L = math.hypot(a, h)
    print(f"d_base={geom['d_base']:.6f}, d_apex={geom['d_apex']:.6f}, L={L:.6f}, r_used={geom['r']:.6f}")

    print("\n# Key points (Ab, As, Bb, Bs, Cr, Cl)")
    for k in ("Ab", "As", "Bb", "Bs", "Cr", "Cl"):
        x, y = geom[k]
        print(f"{k} = ({x:.6f}, {y:.6f})")

    print("\n# SVG path 'd' (rounded triangle head)")
    print(path_d)

    print("\n# Example snippet you can paste into your <symbol> (head only):")
    print(f'<path fill="currentColor" d="{path_d}"/>')
