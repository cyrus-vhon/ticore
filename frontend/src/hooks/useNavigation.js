import { useState, useEffect, useCallback } from 'react'

export const VALID_PAGES = [
  'home',
  'courts',
  'calendar',
  'reservation',
  'my-reservations',
  'reservation-details',
  'about',
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'account',
  'official-dashboard',
  'official-reservations',
  'official-calendar',
  'official-closures',
  'official-portal',
  'official-reports',
  'unauthorized',
  'not-found',
  'server-error',
]

export const ROUTE_ALIASES = Object.freeze({
  dashboard: 'official-dashboard',
  reservations: 'my-reservations',
  profile: 'account',
  admin: 'official-dashboard',
  reports: 'official-reports',
  error: 'server-error',
})

/**
 * Resolves the target page ID from current window location (supporting both hash and SPA path direct navigation).
 */
export function resolveRouteFromLocation(defaultPage = 'home') {
  if (typeof window === 'undefined') return defaultPage

  const fullHash = (window.location.hash || '').replace(/^#\/?/, '').trim()
  const rawPath = (window.location.pathname || '').replace(/^\/+|\/+$/g, '').trim().toLowerCase()

  // 1. Password recovery detection from hash or search query
  if (
    fullHash.includes('type=recovery') ||
    fullHash.startsWith('reset-password') ||
    (window.location.search && window.location.search.includes('type=recovery'))
  ) {
    return 'reset-password'
  }

  // 2. Hash-based routing check (e.g. /#calendar, /#reservation, /#official-dashboard)
  if (fullHash) {
    const rawBase = fullHash.split('?')[0].split('&')[0].toLowerCase()
    const target = ROUTE_ALIASES[rawBase] || rawBase
    if (VALID_PAGES.includes(target)) {
      return target
    }
    return 'not-found'
  }

  // 3. Pathname-based direct routing check (e.g. /calendar, /reservation, /login, /dashboard)
  if (rawPath) {
    const rawBase = rawPath.split('/')[0].split('?')[0]
    const target = ROUTE_ALIASES[rawBase] || rawBase
    if (VALID_PAGES.includes(target)) {
      return target
    }
    return 'not-found'
  }

  return defaultPage
}

/**
 * useNavigation
 * Lightweight, zero-dependency client navigation hook that syncs with window.location.hash
 * and gracefully supports SPA direct path navigation (e.g. /calendar, /reservation, /dashboard).
 */
export function useNavigation(defaultPage = 'home') {
  const getPage = useCallback(() => resolveRouteFromLocation(defaultPage), [defaultPage])

  const [currentPage, setCurrentPage] = useState(getPage)

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPage(getPage())
    }

    window.addEventListener('hashchange', handleLocationChange)
    window.addEventListener('popstate', handleLocationChange)

    return () => {
      window.removeEventListener('hashchange', handleLocationChange)
      window.removeEventListener('popstate', handleLocationChange)
    }
  }, [getPage])

  const navigateTo = useCallback((page, queryString = '') => {
    const normalizedPage = ROUTE_ALIASES[page] || page
    const targetPage = VALID_PAGES.includes(normalizedPage) ? normalizedPage : 'not-found'
    const normalizedQuery = queryString
      ? queryString.startsWith('?')
        ? queryString
        : `?${queryString}`
      : ''
    const nextHash = `#${targetPage}${normalizedQuery}`
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash
    }
    setCurrentPage(targetPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  return {
    currentPage,
    navigateTo,
    pages: VALID_PAGES,
  }
}
