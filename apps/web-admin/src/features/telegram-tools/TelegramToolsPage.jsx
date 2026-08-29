import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { RefreshCw, ShieldAlert, Smartphone, Trash2 } from "lucide-react";
import ConnectAccountModal from "./ConnectAccountModal.jsx";
import DestructiveConfirmDialog from "./DestructiveConfirmDialog.jsx";
const API = `${import.meta.env.VITE_API_URL || "/api"}/admin/telegram-automation`;
export default function TelegramToolsPage() {
  const [config, setConfig] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [operation, setOperation] = useState(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      axios.get(`${API}/config`),
      axios.get(`${API}/accounts`),
    ]);
    setConfig(c.data);
    setAccounts(a.data);
    setAccountId(
      (v) => v || a.data.find((x) => x.status === "CONNECTED")?.id || "",
    );
  }, []);
  const loadGroups = useCallback(async (id) => {
    if (!id) return setGroups([]);
    setGroups((await axios.get(`${API}/accounts/${id}/groups`)).data);
  }, []);
  useEffect(() => {
    load().catch((x) => setMessage(x.response?.data?.message || x.message));
  }, [load]);
  useEffect(() => {
    loadGroups(accountId).catch((x) =>
      setMessage(x.response?.data?.message || x.message),
    );
    setSelected([]);
  }, [accountId, loadGroups]);
  const sync = async () => {
    setMessage("Đang đồng bộ…");
    try {
      await axios.post(`${API}/accounts/${accountId}/sync`);
      await loadGroups(accountId);
      setMessage("Đã đồng bộ nhóm và quyền hiện tại.");
    } catch (x) {
      setMessage(x.response?.data?.message || x.message);
    }
  };
  const setSecondPassword = async () => {
    const currentPassword = config?.destructivePasswordSet
      ? window.prompt("Nhập mật khẩu cấp 2 hiện tại:")
      : "";
    if (config?.destructivePasswordSet && !currentPassword) return;
    const password = window.prompt(
      "Nhập mật khẩu cấp 2 mới (ít nhất 12 ký tự):",
    );
    if (!password) return;
    try {
      await axios.put(`${API}/destructive-password`, {
        password,
        currentPassword,
      });
      await load();
      setMessage("Đã lưu mật khẩu cấp 2.");
    } catch (x) {
      setMessage(x.response?.data?.message || x.message);
    }
  };
  const preview = async (action) => {
    try {
      const created = await axios.post(`${API}/operations/preview`, {
        accountId,
        groupIds: selected,
        action,
      });
      setOperation(
        (await axios.get(`${API}/operations/${created.data.id}`)).data,
      );
    } catch (x) {
      setMessage(x.response?.data?.message || x.message);
    }
  };
  const poll = (id) => {
    setOperation(null);
    setMessage("Đã xếp hàng xử lý.");
    const timer = window.setInterval(async () => {
      const r = await axios.get(`${API}/operations/${id}`);
      if (["COMPLETED", "PARTIAL", "FAILED"].includes(r.data.status)) {
        clearInterval(timer);
        setMessage(
          `Kết quả ${r.data.status}: thành công ${r.data.completed_groups}/${r.data.total_groups}.`,
        );
        await sync();
      }
    }, 2500);
  };
  const configured = config?.apiCredentials && config?.encryptionKey;
  return (
    <div className="space-y-5">
      <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold">
              <ShieldAlert className="text-rose-600" />
              Công cụ Telegram nâng cao
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Chỉ Super Admin được truy cập.
            </p>
          </div>
          <button
            disabled={!configured}
            onClick={() => setConnectOpen(true)}
            className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:bg-slate-300"
          >
            <Smartphone className="mr-2 inline h-4 w-4" />
            Thêm tài khoản
          </button>
        </div>
        {!configured && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Cần cấu hình TELEGRAM_API_ID, TELEGRAM_API_HASH và
            TELEGRAM_SESSION_ENCRYPTION_KEY trên máy chủ.
          </p>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border p-3"
          >
            <option value="">Chọn tài khoản Telegram</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name} — {a.phone_masked} ({a.status})
              </option>
            ))}
          </select>
          <button
            disabled={!accountId}
            onClick={sync}
            className="rounded-xl border px-5 py-3 font-semibold"
          >
            <RefreshCw className="mr-2 inline h-4 w-4" />
            Đồng bộ
          </button>
          <button
            onClick={setSecondPassword}
            className="rounded-xl border px-5 py-3 font-semibold"
          >
            {config?.destructivePasswordSet
              ? "Đổi mật khẩu cấp 2"
              : "Tạo mật khẩu cấp 2"}
          </button>
        </div>
      </section>
      {message && (
        <div className="rounded-xl border bg-white p-4 text-sm">{message}</div>
      )}
      <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h3 className="font-bold">
            Nhóm tài khoản đang quản lý ({groups.length})
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Chọn tối đa 20 nhóm; quyền được kiểm tra lại lúc chạy.
          </p>
        </div>
        <div className="divide-y">
          {groups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50 sm:items-center"
            >
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                disabled={!g.is_admin}
                onChange={(e) =>
                  setSelected((v) =>
                    e.target.checked
                      ? [...v, g.id]
                      : v.filter((id) => id !== g.id),
                  )
                }
                className="mt-1 h-4 w-4 sm:mt-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{g.title}</p>
                <p className="text-xs text-slate-500">
                  {g.member_count || "?"} thành viên ·{" "}
                  {g.is_owner
                    ? "Owner — xóa hẳn"
                    : g.is_admin
                      ? "Admin — chỉ dọn nhóm"
                      : "Không đủ quyền"}
                </p>
              </div>
            </label>
          ))}
        </div>
        <div className="sticky bottom-0 flex flex-col gap-3 border-t bg-white/95 p-4 sm:flex-row sm:justify-end">
          <span className="self-center text-sm text-slate-500">
            Đã chọn {selected.length}
          </span>
          <button
            disabled={!selected.length || !config?.destructivePasswordSet}
            onClick={() => preview("RESET")}
            className="rounded-xl border border-amber-300 px-5 py-3 font-semibold text-amber-700 disabled:opacity-40"
          >
            Dọn thành viên & dữ liệu
          </button>
          <button
            disabled={!selected.length || !config?.destructivePasswordSet}
            onClick={() => preview("DELETE")}
            className="rounded-xl bg-rose-600 px-5 py-3 font-semibold text-white disabled:opacity-40"
          >
            <Trash2 className="mr-2 inline h-4 w-4" />
            Xóa theo quyền
          </button>
        </div>
      </section>
      {connectOpen && (
        <ConnectAccountModal
          onClose={() => setConnectOpen(false)}
          onConnected={() => {
            setConnectOpen(false);
            load();
          }}
        />
      )}
      {operation && (
        <DestructiveConfirmDialog
          operation={operation}
          onClose={() => setOperation(null)}
          onQueued={poll}
        />
      )}
    </div>
  );
}
