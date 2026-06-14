import { useEffect, useRef } from 'react'
import { cn } from '../../lib/utils'

const VERTEX_SHADER = `
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;

  uniform float time;
  uniform float xScale;
  uniform float yScale;
  uniform float distortion;
  uniform vec2 resolution;

  void main() {
    vec2 p = (gl_FragCoord.xy / resolution.xy) * 2.0 - 1.0;
    p.x *= resolution.x / resolution.y;

    float d = length(p) * distortion;
    float rx = p.x * (1.0 + d);
    float gx = p.x;
    float bx = p.x * (1.0 - d);

    float r = 0.05 / abs(p.y + sin((rx + time) * xScale) * yScale);
    float g = 0.05 / abs(p.y + sin((gx + time) * xScale) * yScale);
    float b = 0.05 / abs(p.y + sin((bx + time) * xScale) * yScale);

    float alpha = clamp(max(max(r, g), b) * 0.72, 0.0, 0.58);
    gl_FragColor = vec4(r, g, b, alpha);
  }
`

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function WaveLightShader({ className }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const gl = canvas?.getContext('webgl', { alpha: true, antialias: false })
    if (!canvas || !gl) return undefined

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    if (!vertexShader || !fragmentShader) return undefined

    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    gl.useProgram(program)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const uniforms = {
      time: gl.getUniformLocation(program, 'time'),
      xScale: gl.getUniformLocation(program, 'xScale'),
      yScale: gl.getUniformLocation(program, 'yScale'),
      distortion: gl.getUniformLocation(program, 'distortion'),
      resolution: gl.getUniformLocation(program, 'resolution'),
    }

    gl.uniform1f(uniforms.xScale, 1.0)
    gl.uniform1f(uniforms.yScale, 0.5)
    gl.uniform1f(uniforms.distortion, 0.05)

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.uniform2f(uniforms.resolution, width, height)
    }

    let frame
    let shaderTime = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const render = () => {
      resize()
      gl.clear(gl.COLOR_BUFFER_BIT)
      shaderTime += reduceMotion ? 0 : 0.01
      gl.uniform1f(uniforms.time, shaderTime)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      frame = window.requestAnimationFrame(render)
    }
    render()

    return () => {
      window.cancelAnimationFrame(frame)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" className={cn('pointer-events-none', className)} />
}
