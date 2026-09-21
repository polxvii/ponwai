import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ComparePage } from './features/compare/ComparePage'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('ไม่พบ #root')

createRoot(root).render(
  <StrictMode>
    <ComparePage />
  </StrictMode>,
)
