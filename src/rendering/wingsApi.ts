// [plan4:ST-4] The one place the renderer gets the wing options from. While the Architect's src/data/wings.ts is not merged this re-exports the temporary
// stub; the swap is this single line: `export { wingOptions, type WingOption } from '../data/wings';` (then delete ./wingsStub.ts).
export { wingOptions, type WingOption } from './wingsStub';
