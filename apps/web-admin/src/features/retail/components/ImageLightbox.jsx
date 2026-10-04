import { X, ExternalLink } from 'lucide-react';

export default function ImageLightbox({ photo, onClose }) {
  if (!photo) return null;

  const { url, title, address, time } = photo;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-3 sm:p-4">
          <div className="min-w-0 pr-3">
            <h4 className="truncate font-bold text-slate-900 text-xs sm:text-sm">{title || 'Ảnh minh chứng check-in'}</h4>
            {address && <p className="truncate text-[11px] sm:text-xs text-slate-500">{address}</p>}
            {time && <p className="text-[10px] sm:text-[11px] font-semibold text-blue-600 mt-0.5">Thời gian: {time}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 active:bg-slate-300"
            aria-label="Đóng"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        <div className="flex max-h-[70vh] items-center justify-center bg-slate-950 p-2">
          <img
            src={url}
            alt={title || 'Ảnh check-in'}
            className="max-h-[65vh] w-auto max-w-full rounded-lg object-contain"
          />
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
          <span className="text-xs text-slate-500">Minh chứng thực tế tại điểm bán</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
          >
            Mở ảnh gốc <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
