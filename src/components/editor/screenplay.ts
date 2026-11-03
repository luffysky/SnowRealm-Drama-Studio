'use client'

import { Extension } from '@tiptap/react'

/**
 * Screenplay formatting.
 *
 * A screenplay is not a different document model, it is paragraphs that know
 * what they are: an action line, a character cue, a line of dialogue, a
 * parenthetical, a transition. So this adds one attribute to the paragraph
 * rather than five new node types.
 *
 * The payoff is that everything else keeps working — undo, copy and paste, the
 * character count, the version snapshot — and a script opened without this
 * module still reads as ordinary paragraphs instead of as an error. Custom
 * nodes would have made every one of those a special case.
 */

export const SCRIPT_BLOCKS = [
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
] as const
export type ScriptBlock = (typeof SCRIPT_BLOCKS)[number]

export const SCRIPT_BLOCK_LABEL: Record<ScriptBlock, string> = {
  action: '動作／畫面',
  character: '角色名',
  dialogue: '對白',
  parenthetical: '語氣提示',
  transition: '轉場',
}

/** Alt + the number, so nothing collides with the browser's own shortcuts. */
export const SCRIPT_BLOCK_SHORTCUT: Record<ScriptBlock, string> = {
  action: 'Alt-1',
  character: 'Alt-2',
  dialogue: 'Alt-3',
  parenthetical: 'Alt-4',
  transition: 'Alt-5',
}

/**
 * What pressing Enter at the end of a block should produce.
 *
 * Writing a screenplay is mostly 角色名 → 對白 → 動作, over and over. Getting
 * that sequence for free is most of what a screenplay mode is for.
 */
const NEXT_BLOCK: Record<ScriptBlock, ScriptBlock> = {
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'action',
  action: 'action',
  transition: 'action',
}

declare module '@tiptap/react' {
  interface Commands<ReturnType> {
    screenplay: {
      setScriptBlock: (block: ScriptBlock) => ReturnType
      toggleScriptBlock: (block: ScriptBlock) => ReturnType
    }
  }
}

export const Screenplay = Extension.create({
  name: 'screenplay',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          scriptBlock: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-script'),
            renderHTML: (attributes) => {
              const value = attributes.scriptBlock as string | null
              if (!value) return {}
              return { 'data-script': value, class: `script-${value}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setScriptBlock:
        (block) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { scriptBlock: block }),

      toggleScriptBlock:
        (block) =>
        ({ editor, commands }) => {
          const current = editor.getAttributes('paragraph').scriptBlock as string | null
          return commands.updateAttributes('paragraph', {
            scriptBlock: current === block ? null : block,
          })
        },
    }
  },

  addKeyboardShortcuts() {
    const shortcuts: Record<string, () => boolean> = {}

    for (const block of SCRIPT_BLOCKS) {
      shortcuts[SCRIPT_BLOCK_SHORTCUT[block]] = () =>
        this.editor.commands.toggleScriptBlock(block)
    }

    // Enter continues the usual sequence instead of repeating the last block.
    shortcuts.Enter = () => {
      const current = this.editor.getAttributes('paragraph').scriptBlock as ScriptBlock | null
      if (!current) return false

      return this.editor
        .chain()
        .splitBlock()
        .updateAttributes('paragraph', { scriptBlock: NEXT_BLOCK[current] })
        .run()
    }

    return shortcuts
  },
})
