import * as R from 'ramda'
import MiniSearch from 'minisearch'

export const createIndex = () => new MiniSearch({
  fields: ['text', 'tags', 'scope'],
  tokenize: string => {
    const tokens = R.uniq([
      ...string.split(/[\s-/]/), // A: el clásico
      ...string.split(/([/]?["\w]+[.]?)|[ /]/), // B: leading '/' and trailing '.'
      ...string.split(/([\d/]+)/), // C: trailing '/'
      ...string.split(/([\d ]+)/) // D: separate numbers and words
    ]
      .map(s => s ? s.trim() : '')
      .filter(s => !s.includes(' ')) // filter tokens with blanks introduced by C
      .filter(Boolean)
    )

    return tokens
  },

  extractField: (document, fieldName) => {
    const value = document[fieldName]
    return value && fieldName === 'tags'
      ? value.flat().filter(R.identity).join(' ')
      : value
  }
})


export const parseQuery = s => {
  const tokens = (s || '').split(' ')
  const parts = tokens.reduce((acc, token) => {
    if (token.startsWith('@')) token.length > 2 && acc.scope.push(token.substring(1))
    else if (token.startsWith('#')) token.length > 2 && acc.tags.push(token.substring(1))
    else if (token.startsWith('!')) token.length > 2 && acc.ids.push(token.substring(1))
    else if (token) acc.text.push(token)
    return acc
  }, { scope: [], text: [], tags: [], ids: [] })

  const query = { combineWith: 'AND', queries: [] }

  const add = (field, combineWith, prefix) => {
    const queries = parts[field]
    if (!queries || !queries.length) return
    query.queries.push({ fields: [field], combineWith, queries, prefix })
  }

  add('scope', 'OR')
  add('text', 'AND', true)
  add('tags', 'AND', true)

  const filter = parts.ids && parts.ids.length
    ? result => parts.ids.some(id => result.id.startsWith(id))
    : null

  return filter
    ? [query, { filter }]
    : [query]
}
