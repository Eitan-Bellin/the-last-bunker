/**
 * LightmapFilter: multiplies the lit group (mid plane + play plane) by the screen-space light texture, KEEPING the group's alpha.
 *
 * Prototype A patched Pixi's 'multiply' blend map to get "multiply-keep-alpha"; that touched global renderer state. This filter does
 * the same maths in a shader instead: rgb = src.rgb * light.rgb * gain (clamped to premultiplied alpha), a = src.a. Open caverns
 * (transparent pixels of the lit group) stay transparent, so the far/back planes behind them are never darkened.
 *
 * Screen UV. The light texture is drawn in screen space (lightRoot carries the camera transform). The filter quad covers the
 * group's bounds, wherever Pixi put them, and the group sits inside worldContainer, which carries PostFX's own filter: a nested
 * filter. Two ways to know where a fragment is on screen:
 *  - 'global' (default): Pixi 8's global filter uniforms. For a single-filter effect the output frame is `bounds - parentOffset`
 *    and uGlobalFrame.xy is `parentOffset * resolution`, so `(aPosition * frame.zw + frame.xy) * res + global.xy` is the pixel on
 *    the root target, and dividing by uGlobalFrame.zw gives screen UV. Correct nested or not.
 *  - 'area' (fallback, "world-matrix"): the host pins the group's filterArea to the screen rectangle in the group's local space
 *    (it knows the camera matrix), so the quad IS the screen and aPosition is the UV.
 * Resolution is 'inherit' (a Filter defaults to 1 and would blur the world on every high-DPI screen).
 */
import { Filter, GlProgram, type Texture } from 'pixi.js';
import { LIGHTMAP_RENDER, type LightmapUvMode } from '../tokensRender';

const vertex = /* glsl */ `in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreenUV;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec4 uGlobalFrame;
uniform float uMode;
uniform float uRes;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    vec2 px = (aPosition * uOutputFrame.zw + uOutputFrame.xy) * uRes + uGlobalFrame.xy;
    vScreenUV = mix(px / uGlobalFrame.zw, aPosition, uMode);
}
`;

const fragment = /* glsl */ `in vec2 vTextureCoord;
in vec2 vScreenUV;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uLight;
uniform vec2 uLightUV;
uniform float uGain;
uniform float uShoulder;

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec3 l = texture(uLight, vScreenUV * uLightUV).rgb * uGain;
    vec3 e = max(l - 1.0, 0.0);
    l = min(l, vec3(1.0)) + e / (1.0 + e * uShoulder);
    finalColor = vec4(min(c.rgb * l, vec3(c.a)), c.a);
}
`;

export class LightmapFilter extends Filter {
  constructor(light: Texture) {
    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'city-lightmap' }),
      resources: {
        lightmapUniforms: {
          uLightUV: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uGain: { value: LIGHTMAP_RENDER.gain, type: 'f32' },
          uShoulder: { value: LIGHTMAP_RENDER.shoulder, type: 'f32' },
          uMode: { value: 0, type: 'f32' },
          uRes: { value: 1, type: 'f32' },
        },
        uLight: light.source,
      },
      resolution: 'inherit',
    });
  }

  private get u(): { uLightUV: Float32Array; uGain: number; uMode: number; uRes: number } {
    return this.resources.lightmapUniforms.uniforms;
  }

  /** Point the filter at a (new) light texture; `usedW/H` is the part of it the light pass drew (the texture is rounded up). */
  setLight(light: Texture, usedW: number, usedH: number): void {
    this.resources.uLight = light.source;
    const uv = this.u.uLightUV;
    uv[0] = usedW / light.source.width;
    uv[1] = usedH / light.source.height;
  }

  /** The renderer's resolution (pixels per CSS px): needed to turn the output frame into root-target pixels. */
  set res(r: number) {
    if (this.u.uRes !== r) this.u.uRes = r;
  }

  set mode(m: LightmapUvMode) {
    const v = m === 'area' ? 1 : 0;
    if (this.u.uMode !== v) this.u.uMode = v;
  }

  set gain(g: number) {
    if (this.u.uGain !== g) this.u.uGain = g;
  }
}
