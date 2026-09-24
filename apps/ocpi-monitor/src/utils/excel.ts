// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import * as XLSX from 'xlsx'

export interface ExcelSheet {
  name: string
  rows: Array<Record<string, string | number>>
}

/** Excel sheet names: max 31 chars, no : \ / ? * [ ] , and must be unique in the workbook. */
function sanitizeSheetName (name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, '-').trim() || 'Sheet').slice(0, 31)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    const suffixText = `-${suffix}`
    candidate = `${base.slice(0, 31 - suffixText.length)}${suffixText}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

export function downloadExcelWorkbook (filename: string, sheets: ExcelSheet[]): void {
  const workbook = XLSX.utils.book_new()
  const usedNames = new Set<string>()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name, usedNames))
  }
  XLSX.writeFile(workbook, filename)
}
