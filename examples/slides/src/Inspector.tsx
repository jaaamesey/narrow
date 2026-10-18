import { useNarrowedStore } from 'react-narrow'
import { deckStore } from './deck'

export function Inspector() {
  const { selectedShapeId } = deckStore.useVal()
  return (
    <aside className="inspector">
      {selectedShapeId ? <ShapeInspector id={selectedShapeId} /> : <p className="hint">Select a shape to edit it.</p>}
    </aside>
  )
}

function ShapeInspector({ id }: { id: string }) {
  const deck = deckStore.useVal()
  const setDeck = deckStore.useSet()
  const [shape, setShape] = useNarrowedStore(
    deck,
    (d) => d.slides.find((s) => s.id === d.selectedSlideId)?.shapes.find((s) => s.id === id),
    setDeck,
  )

  const number = (key: 'x' | 'y' | 'w' | 'h') => (
    <label>
      {key}
      <input
        type="number"
        value={Math.round(shape[key])}
        onChange={(e) =>
          setShape((s) => {
            s[key] = Number(e.target.value)
          })
        }
      />
    </label>
  )

  return (
    <>
      {shape.kind === 'text' && (
        <label className="wide">
          Text
          <textarea
            value={shape.text}
            onChange={(e) =>
              setShape((s) => {
                s.text = e.target.value
              })
            }
          />
        </label>
      )}
      <div className="grid">
        {number('x')}
        {number('y')}
        {number('w')}
        {number('h')}
      </div>
      <label>
        Colour
        <input
          type="color"
          value={shape.color}
          onChange={(e) =>
            setShape((s) => {
              s.color = e.target.value
            })
          }
        />
      </label>
    </>
  )
}
