import { createContextStore } from 'react-narrow'

export type Shape = {
  id: string
  kind: 'box' | 'text'
  x: number
  y: number
  w: number
  h: number
  color: string
  text: string
}
export type Slide = { id: string; shapes: Shape[] }
export type Deck = { slides: Slide[]; selectedSlideId: string; selectedShapeId: string | null }

export const deckStore = createContextStore<Deck>()

export const newShape = (kind: Shape['kind']): Shape =>
  kind === 'text'
    ? { id: crypto.randomUUID(), kind, x: 80, y: 60, w: 480, h: 80, color: '#1f2937', text: 'Text' }
    : { id: crypto.randomUUID(), kind, x: 120, y: 180, w: 200, h: 120, color: '#60a5fa', text: '' }

const titleSlide = (title: string): Slide => ({
  id: crypto.randomUUID(),
  shapes: [{ ...newShape('text'), text: title }, newShape('box')],
})

export const initialDeck = (): Deck => {
  const slides = ['Welcome', 'The problem', 'Our approach'].map(titleSlide)
  return { slides, selectedSlideId: slides[0]!.id, selectedShapeId: null }
}
