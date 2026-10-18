import { NarrowList, useNarrowedStore } from 'react-narrow'
import { deckStore, initialDeck, newShape, type Shape, type Slide } from './deck'
import { ShapeView } from './ShapeView'
import { Inspector } from './Inspector'

export function App() {
  return (
    <deckStore.Provider initial={initialDeck}>
      <div className="app">
        <Toolbar />
        <SlideList />
        <Canvas />
        <Inspector />
      </div>
    </deckStore.Provider>
  )
}

function Toolbar() {
  const setDeck = deckStore.useSet()

  const addSlide = () =>
    setDeck((d) => {
      const slide = { id: crypto.randomUUID(), shapes: [newShape('text')] }
      d.slides.push(slide)
      d.selectedSlideId = slide.id
      d.selectedShapeId = null
    })

  const addShape = (kind: Shape['kind']) =>
    setDeck((d) => {
      const shape = newShape(kind)
      d.slides.find((s) => s.id === d.selectedSlideId)!.shapes.push(shape)
      d.selectedShapeId = shape.id
    })

  const deleteSelected = () =>
    setDeck((d) => {
      const slide = d.slides.find((s) => s.id === d.selectedSlideId)!
      if (d.selectedShapeId) {
        slide.shapes = slide.shapes.filter((s) => s.id !== d.selectedShapeId)
        d.selectedShapeId = null
      } else if (d.slides.length > 1) {
        const i = d.slides.indexOf(slide)
        d.slides.splice(i, 1)
        d.selectedSlideId = d.slides[Math.max(0, i - 1)]!.id
      }
    })

  return (
    <header className="toolbar">
      <button onClick={addSlide}>New slide</button>
      <button onClick={() => addShape('text')}>Text</button>
      <button onClick={() => addShape('box')}>Box</button>
      <button onClick={deleteSelected}>Delete</button>
    </header>
  )
}

function SlideList() {
  const deck = deckStore.useVal()
  const setDeck = deckStore.useSet()
  const [slides, setSlides] = useNarrowedStore(deck, (d) => d.slides, setDeck)

  return (
    <ol className="slide-list">
      <NarrowList items={slides} setStore={setSlides} getKey={(s) => s.id}>
        {(slide) => (
          <SlideThumb
            slide={slide}
            selected={slide.id === deck.selectedSlideId}
            onSelect={() =>
              setDeck((d) => {
                d.selectedSlideId = slide.id
                d.selectedShapeId = null
              })
            }
          />
        )}
      </NarrowList>
    </ol>
  )
}

function SlideThumb({ slide, selected, onSelect }: { slide: Slide; selected: boolean; onSelect: () => void }) {
  return (
    <li className={selected ? 'thumb selected' : 'thumb'} onClick={onSelect}>
      <div className="slide thumb-slide">
        {slide.shapes.map((shape) => (
          <ShapeView key={shape.id} shape={shape} />
        ))}
      </div>
    </li>
  )
}

function Canvas() {
  const deck = deckStore.useVal()
  const setDeck = deckStore.useSet()
  const [slide, setSlide] = useNarrowedStore(deck, (d) => d.slides.find((s) => s.id === d.selectedSlideId), setDeck)
  const [shapes, setShapes] = useNarrowedStore(slide, (s) => s.shapes, setSlide)

  return (
    <main className="stage">
      <div
        className="slide canvas"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget)
            setDeck((d) => {
              d.selectedShapeId = null
            })
        }}
      >
        <NarrowList items={shapes} setStore={setShapes} getKey={(s) => s.id}>
          {(shape, setShape) => (
            <ShapeView
              shape={shape}
              setShape={setShape}
              selected={shape.id === deck.selectedShapeId}
              onSelect={() =>
                setDeck((d) => {
                  d.selectedShapeId = shape.id
                })
              }
            />
          )}
        </NarrowList>
      </div>
    </main>
  )
}
