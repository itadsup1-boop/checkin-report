/**
 * Bước 1: chọn cơ sở nhận hàng.
 *
 * Danh sách cơ sở lấy từ shared-ui/core/branches.js — `code` phải khớp giá trị
 * cột tk_inventory.branch, server chỉ nhận 'US' hoặc 'UK'.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { BRANCHES } from '../data/import-repo.js';
import { branchOption } from '../ui/components.js';

/**
 * @param {object} params
 * @param {?string} params.branch mã cơ sở đang chọn
 * @param {(code:string) => void} params.onPick
 */
export function createBranchStep({ branch, onPick }) {
    const root = h('div');
    let selected = branch;

    function render() {
        replaceChildren(root,
            h('div', { class: 'hint' }, 'Hàng nhập sẽ được cộng vào tồn kho cơ sở này'),
            BRANCHES.map(item => branchOption({
                branch: item,
                selected: selected === item.code,
                onPick: code => {
                    selected = code;
                    render();
                    onPick(code);
                }
            }))
        );
    }

    render();
    return root;
}
