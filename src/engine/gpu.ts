// Каква е видеокартата → разумно качество при първо пускане (после играчът избира сам, AutoQuality сваля при нужда).
export type GpuQuality = 'low' | 'medium' | 'high';

/** Името на видеокартата (напр. „ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 …)“). */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(s ?? '');
  } catch { return ''; }
}

/** Груба оценка по името: отделна видеокарта → „Високо“, вградена → „Средно“/„Ниско“, телефон → „Ниско“. */
export function qualityForGpu(name: string): GpuQuality {
  const n = name.toLowerCase();
  if (!n) return 'medium';
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(n)) return 'low';
  if (/mali|adreno|powervr|videocore|apple gpu|sgx|tegra/.test(n)) return 'low';
  // слабите мобилни NVIDIA (MX…) и стари GT → средно
  if (/geforce (mx|gt )|\bmx ?[1-4]\d0\b|geforce [1-9]\d0m?\b/.test(n)) return 'medium';
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(n)) return 'high';
  if (/radeon.*(rx|pro|r9|vii)|rx ?\d{3,4}/.test(n)) return 'high';
  if (/intel.*arc|arc\(tm\)|arc a\d/.test(n)) return 'high';
  if (/apple m\d/.test(n)) return 'medium';
  if (/iris|radeon|vega/.test(n)) return 'medium';
  if (/intel|uhd|hd graphics/.test(n)) return 'low';
  return 'medium';
}
