import type { SetStore } from 'react-narrow'
import type { Shape } from './deck'

// Without `setShape` it's a static preview (used by the thumbnails).
export function ShapeView({
  shape,
  setShape,
  selected,
  onSelect,
}: {
  shape: Shape
  setShape?: SetStore<Shape>
  selected?: boolean
  onSelect?: () => void
}) {
  const style = {
    left: shape.x,
    top: shape.y,
    width: shape.w,
    height: shape.h,
    ...(shape.kind === 'box' ? { background: shape.color } : { color: shape.color }),
  }
  return (
    <div
      className={['shape', shape.kind, selected && 'selected'].filter(Boolean).join(' ')}
      style={style}
      onPointerDown={
        setShape &&
        ((e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onSelect?.()
        })
      }
      onPointerMove={
        setShape &&
        ((e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const { movementX: dx, movementY: dy } = e
          setShape((s) => {
            s.x += dx
            s.y += dy
          })
        })
      }
    >
      {shape.kind === 'text' && shape.text}
    </div>
  )
}
