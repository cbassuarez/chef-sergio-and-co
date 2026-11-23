import type { ComponentType } from 'react'
import { Layout } from './components/Layout'
import { MotionRoot } from './components/motion'
import './styles.css'
import './components/HomeHero.css'
import './components/DishCarousel.css'
import './components/PlatingTimeline.css'
import './pages/About.css'
import './components/SiteNavigation.css'
import './components/SiteFooter.css'
import './components/CallToAction.css'
import './components/SiteHeader.css'
import './components/SelectedMotion.css'
import './components/NavigationMotion.css'

/** The page component is passed in: the server renders every route; the browser loads only the current route's code. */
export function App({ path, Page }: { path: string; Page: ComponentType }) {
  return (
    <MotionRoot>
      <Layout route={path}>
        <Page />
      </Layout>
    </MotionRoot>
  )
}
