import { describe, expect, it } from 'vitest'
import {
  defaultModules,
  EDITOR_MODULES,
  isEditorModuleId,
  modulesFor,
  normaliseModules,
} from '@/lib/editor/modules'
import { countRichTextChars } from '@/lib/utils'

/**
 * The editor is assembled from switchable modules, and the word count is read
 * off rich-text HTML. Both are places where a quiet mistake shows up as a
 * wrong number on four other pages.
 */

describe('countRichTextChars', () => {
  it('counts the prose, not the markup', () => {
    expect(countRichTextChars('<p>夜色深沉</p>')).toBe(4)
    expect(countRichTextChars('<p><strong>夜色</strong><em>深沉</em></p>')).toBe(4)
  })

  it('does not run two paragraphs together', () => {
    // Without the block-tag rule this would still be 2, but the text would be
    // "甲乙" — which breaks the moment anything counts words rather than chars.
    expect(countRichTextChars('<p>甲</p><p>乙</p>')).toBe(2)
  })

  it('decodes the entities that actually appear', () => {
    expect(countRichTextChars('<p>A&amp;B</p>')).toBe(3)
    expect(countRichTextChars('<p>&lt;&gt;</p>')).toBe(2)
    expect(countRichTextChars('<p>甲&nbsp;乙</p>')).toBe(2)
  })

  it('ignores whitespace and empty documents', () => {
    expect(countRichTextChars('')).toBe(0)
    expect(countRichTextChars('<p></p>')).toBe(0)
    expect(countRichTextChars('<p>  \n  </p>')).toBe(0)
  })

  it('does not count attribute values as prose', () => {
    expect(countRichTextChars('<p class="very-long-class-name">甲</p>')).toBe(1)
    expect(countRichTextChars('<img src="/api/files/abc" alt="封面">')).toBe(0)
  })

  it('treats plain text written before rich text was added as prose', () => {
    expect(countRichTextChars('夜色深沉')).toBe(4)
  })
})

describe('editor modules', () => {
  it('offers 劇本格式 only on the script surface', () => {
    expect(modulesFor('SCRIPT').map((m) => m.id)).toContain('screenplay')
    expect(modulesFor('NOVEL').map((m) => m.id)).not.toContain('screenplay')
  })

  it('gives each surface a sensible default set', () => {
    expect(defaultModules('NOVEL')).toContain('headings')
    expect(defaultModules('SCRIPT')).toContain('screenplay')
    // 對齊 is for transitions in a screenplay, not for prose.
    expect(defaultModules('SCRIPT')).toContain('align')
    expect(defaultModules('NOVEL')).not.toContain('align')
  })

  it('always keeps the locked modules on', () => {
    // A stored list that disabled paragraphs would leave a box nobody can
    // type in, so normalising forces them back.
    expect(normaliseModules('NOVEL', [])).toContain('core')
    expect(normaliseModules('NOVEL', ['headings'])).toContain('core')
  })

  it('drops unknown ids and ids from another surface', () => {
    const result = normaliseModules('NOVEL', ['headings', 'screenplay', 'nonsense', 42])
    expect(result).toContain('headings')
    expect(result).not.toContain('screenplay')
    expect(result).not.toContain('nonsense')
  })

  it('returns modules in registry order whatever order they were stored in', () => {
    const forwards = normaliseModules('NOVEL', ['headings', 'lists', 'marks'])
    const backwards = normaliseModules('NOVEL', ['marks', 'lists', 'headings'])
    expect(forwards).toEqual(backwards)
  })

  it('describes every module, because the toggle menu shows it', () => {
    for (const entry of EDITOR_MODULES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(isEditorModuleId(entry.id)).toBe(true)
    }
  })
})
