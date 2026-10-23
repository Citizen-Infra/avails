export const MAX_DATES_PER_PAGE = 7

export function paginateDates(dates, capacity = MAX_DATES_PER_PAGE) {
  if (!dates.length) return []

  const maximum = Math.max(1, Math.min(MAX_DATES_PER_PAGE, Math.floor(capacity) || 1))
  const pageCount = Math.ceil(dates.length / maximum)
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
