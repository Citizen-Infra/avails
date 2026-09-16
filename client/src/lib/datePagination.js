export const MAX_DATES_PER_PAGE = 7

export function paginateDates(dates) {
  if (!dates.length) return []

  const pageCount = Math.ceil(dates.length / MAX_DATES_PER_PAGE)
  const basePageSize = Math.floor(dates.length / pageCount)
  const largerPageCount = dates.length % pageCount
  const pages = []
  let offset = 0

  for (let page = 0; page < pageCount; page++) {
    const pageSize = basePageSize + (page < largerPageCount ? 1 : 0)
    pages.push(dates.slice(offset, offset + pageSize))
    offset += pageSize
  }

  return pages
}
