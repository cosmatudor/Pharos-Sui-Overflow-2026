import { useEffect, useRef } from "react"

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
}

interface Ring {
  r: number
  alpha: number
}

const NODE_COUNT = 48
const MAX_LINK   = 180
const SPEED      = 0.22
const BEAM_SPEED = 0.0018
const RING_SPEED = 0.8
const RING_MAX   = 320

// Lantern core is at cy=52 in viewBox "0 0 80 180", SVG displayed at height=162
const LANTERN_FRAC = 52 / 180

export default function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animId: number
    let beamAngle  = Math.PI * 0.6
    let beaconPulse = 0
    const rings: Ring[] = []
    let ringTimer = 0

    // Beacon position as fraction of canvas size — measured from DOM
    let bxFrac = 0.5
    let byFrac = 0.38

    const measureBeacon = () => {
      const lh  = document.getElementById("pharos-lighthouse")
      const cvs = canvas
      if (!lh || !cvs) return
      const lhRect  = lh.getBoundingClientRect()
      const cvRect  = cvs.getBoundingClientRect()
      const lanternAbsY = lhRect.top - cvRect.top + lhRect.height * LANTERN_FRAC
      bxFrac = (lhRect.left - cvRect.left + lhRect.width * 0.5) / cvs.offsetWidth
      byFrac = lanternAbsY / cvs.offsetHeight
    }

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
      measureBeacon()
    }

    resize()
    // Measure after first paint so the lighthouse has rendered
    setTimeout(measureBeacon, 80)

    const W = () => canvas.offsetWidth
    const H = () => canvas.offsetHeight

    const nodes: Node[] = Array.from({ length: NODE_COUNT }, () => ({
      x:       Math.random() * W(),
      y:       Math.random() * H(),
      vx:      (Math.random() - 0.5) * SPEED,
      vy:      (Math.random() - 0.5) * SPEED * 0.7,
      size:    Math.random() * 1.4 + 0.8,
      opacity: Math.random() * 0.45 + 0.25,
    }))

    const draw = () => {
      const w  = W()
      const h  = H()
      const bx = w * bxFrac
      const by = h * byFrac

      ctx.clearRect(0, 0, w, h)

      // ── Sweeping beam ──
      beamAngle += BEAM_SPEED
      const beamLen  = Math.max(w, h) * 1.4
      const beamHalf = 0.12

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + Math.cos(beamAngle - beamHalf) * beamLen, by + Math.sin(beamAngle - beamHalf) * beamLen)
      ctx.lineTo(bx + Math.cos(beamAngle + beamHalf) * beamLen, by + Math.sin(beamAngle + beamHalf) * beamLen)
      ctx.closePath()
      const beamGrad = ctx.createLinearGradient(bx, by, bx + Math.cos(beamAngle) * beamLen, by + Math.sin(beamAngle) * beamLen)
      beamGrad.addColorStop(0,   "rgba(77,162,255,0.13)")
      beamGrad.addColorStop(0.5, "rgba(77,162,255,0.05)")
      beamGrad.addColorStop(1,   "rgba(77,162,255,0)")
      ctx.fillStyle = beamGrad
      ctx.fill()
      ctx.restore()

      // ── Beacon rings ──
      ringTimer++
      if (ringTimer > 90) {
        rings.push({ r: 4, alpha: 0.5 })
        ringTimer = 0
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        rings[i].r     += RING_SPEED
        rings[i].alpha *= 0.975
        if (rings[i].r > RING_MAX || rings[i].alpha < 0.003) { rings.splice(i, 1); continue }
        ctx.beginPath()
        ctx.arc(bx, by, rings[i].r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(77,162,255,${rings[i].alpha})`
        ctx.lineWidth = 0.8
        ctx.stroke()
      }

      // ── Move nodes ──
      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < 0 || n.x > w) n.vx *= -1
        if (n.y < 0 || n.y > h) n.vy *= -1
      }

      // ── Lines: node → beacon ──
      for (const n of nodes) {
        const dx = n.x - bx
        const dy = n.y - by
        const dist  = Math.sqrt(dx * dx + dy * dy)
        const alpha = Math.max(0, (1 - dist / (Math.max(w, h) * 0.8)) * 0.18)
        if (alpha < 0.005) continue
        ctx.beginPath()
        ctx.strokeStyle = `rgba(77,162,255,${alpha})`
        ctx.lineWidth = 0.5
        ctx.moveTo(n.x, n.y)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }

      // ── Lines: node → node ──
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx   = nodes[i].x - nodes[j].x
          const dy   = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAX_LINK) {
            ctx.beginPath()
            ctx.strokeStyle = `rgba(77,162,255,${(1 - dist / MAX_LINK) * 0.22})`
            ctx.lineWidth = 0.5
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      // ── Beacon glow ──
      beaconPulse = (beaconPulse + 0.025) % (Math.PI * 2)
      const pulseExtra = Math.sin(beaconPulse) * 14
      const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 60 + pulseExtra)
      glow.addColorStop(0,    "rgba(210,235,255,0.9)")
      glow.addColorStop(0.06, "rgba(77,162,255,0.8)")
      glow.addColorStop(0.3,  "rgba(77,162,255,0.2)")
      glow.addColorStop(1,    "rgba(77,162,255,0)")
      ctx.beginPath()
      ctx.arc(bx, by, 60 + pulseExtra, 0, Math.PI * 2)
      ctx.fillStyle = glow
      ctx.fill()

      // Core dot
      ctx.beginPath()
      ctx.arc(bx, by, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(230,245,255,0.98)"
      ctx.fill()

      // ── Keeper nodes ──
      for (const n of nodes) {
        const ng = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.size * 5)
        ng.addColorStop(0, `rgba(77,162,255,${n.opacity * 0.55})`)
        ng.addColorStop(1, "rgba(77,162,255,0)")
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.size * 5, 0, Math.PI * 2)
        ctx.fillStyle = ng
        ctx.fill()

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(140,200,255,${n.opacity})`
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()

    const onResize = () => { resize() }
    window.addEventListener("resize", onResize)
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener("resize", onResize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }}
    />
  )
}