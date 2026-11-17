import { createComponent, defineComponents, Types } from '@iwsdk/core';

/** Marks a pad (a large round button) and names the action it triggers. */
export const Pad = createComponent('MirrorHandPad', {
  action: { type: Types.String, default: '' },
});

export default defineComponents([Pad]);
