import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'

// The 3D scene pulls in three.js, so load it only when the demo page is opened.
const Demo = lazy(() => import('./pages/Demo.jsx'))
const MapPage = lazy(() => import('./pages/Map.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Forecast = lazy(() => import('./pages/Forecast.jsx'))

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null
    if (target) target.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/demo"
          element={
            <Suspense fallback={null}>
              <Demo />
            </Suspense>
          }
        />
        <Route
          path="/map"
          element={
            <Suspense fallback={null}>
              <MapPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <Suspense fallback={null}>
              <Admin />
            </Suspense>
          }
        />
        <Route
          path="/forecast"
          element={
            <Suspense fallback={null}>
              <Forecast />
            </Suspense>
          }
        />
        <Route path="*" element={<Landing />} />
      </Routes>
    </>
  )
}
