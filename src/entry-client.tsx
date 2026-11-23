import { StrictMode, type ComponentType } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { App } from './App'
import { installScrollNavigation } from './scroll-navigation'
import { installNextPage } from './next-page'

installScrollNavigation()
installNextPage()

// Route-level code splitting: each page hydrates with only its own code (the home page never downloads the booking form).
const pages: Record<string, () => Promise<ComponentType>> = {
  '/invitation/': () => import('./booking/EventInvitation').then((m) => m.EventInvitation),
  '/': () => import('./pages/Home').then((m) => m.Home),
  '/privatedining/': () => import('./pages/Services').then((m) => m.PrivateDining),
  '/cookingclasses/': () => import('./pages/Services').then((m) => m.CookingClasses),
  '/catering/': () => import('./pages/Services').then((m) => m.Catering),
  '/sergios-table/': () => import('./pages/Services').then((m) => m.SergiosTable),
  '/about/': () => import('./pages/About').then((m) => m.About),
  '/book/': () => import('./pages/Services').then((m) => m.Book),
  '/gift/': () => import('./pages/Services').then((m) => m.Gift),
  '/shot-list/': () => import('./pages/ShotList').then((m) => m.ShotList),
  '/book/done/': () => import('./booking/StatusPages').then((m) => m.BookDone),
  '/book/pay/': () => import('./booking/StatusPages').then((m) => m.MockCheckout),
}

const root = document.getElementById('root')!
const path = root.dataset.route || '/'
pages[path]?.().then((Page) =>
  hydrateRoot(
    root,
    <StrictMode>
      <App path={path} Page={Page} />
    </StrictMode>,
  ),
)
