import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// BrowserRouter dùng đường dẫn thật (/nhan-su) chứ không phải dấu thăng (#/nhan-su).
// Chạy được vì máy chủ đã trả index.html cho mọi đường dẫn không phải API —
// xem apps/api/index.js, đoạn "Các route không match API sẽ trả về file index.html".
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
