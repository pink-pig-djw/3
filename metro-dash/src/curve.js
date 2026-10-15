// "Curved world" vertex bend: everything sinks and drifts sideways with the
// square of its distance from the camera, which gives the rolling horizon look.
export const curveUniforms = {
  uCurveY: { value: 0.0021 },
  uCurveX: { value: 0.0 },
};

export const BEND = /* glsl */ `
#include <project_vertex>
{
  float d = max(-mvPosition.z, 0.0);
  mvPosition.y -= uCurveY * d * d;
  mvPosition.x += uCurveX * d * d;
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Works for built-in materials and for materials that already have their own
// onBeforeCompile (the VRM toon material), by chaining onto it.
export function curved(material) {
  if (material.userData.curved) return material;
  material.userData.curved = true;
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile.call(material, shader, renderer);
    shader.uniforms.uCurveY = curveUniforms.uCurveY;
    shader.uniforms.uCurveX = curveUniforms.uCurveX;
    shader.vertexShader = 'uniform float uCurveY;\nuniform float uCurveX;\n' +
      shader.vertexShader.replace('#include <project_vertex>', BEND);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}|curved`;
  return material;
}

export function curveObject(root) {
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) curved(m);
  });
}
