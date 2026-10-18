# react-narrow • Slides

A small slide deck editor built with `react-narrow` and the [React Compiler](https://react.dev/learn/react-compiler): add slides, add text and boxes, drag them around, and edit them in the inspector.

```sh
npm install                      # from the repo root
npm run dev -w examples/slides
```

The deck lives in one context store (`src/deck.ts`). The canvas narrows it to the selected slide and then to its shapes, and `NarrowList` gives each shape a setter for itself, which is what dragging uses. The inspector narrows to the selected shape.

None of the components use `memo` or `useCallback`. Dragging a shape or typing into it re-renders that shape and its slide's thumbnail, and nothing else.
