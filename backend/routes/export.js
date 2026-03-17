const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const moment = require('moment');

function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
}

async function getReportData(filters) {
  const { kasType, startDate, endDate, status = 'approved' } = filters;
  let conditions = ['t.status = $1'];
  let params = [status];
  let paramIdx = 2;

  if (kasType) { conditions.push(`t.kas_type = $${paramIdx++}`); params.push(kasType); }
  if (startDate) { conditions.push(`t.transaction_date >= $${paramIdx++}`); params.push(startDate); }
  if (endDate) { conditions.push(`t.transaction_date <= $${paramIdx++}`); params.push(endDate); }

  const result = await pool.query(
    `SELECT t.transaction_number, t.kas_type, t.transaction_type, t.amount,
            t.description, t.reference_number, t.transaction_date, t.status,
            t.notes, c.name as category_name, u.full_name as created_by_name
     FROM kas_transactions t
     LEFT JOIN kas_categories c ON t.category_id = c.id
     LEFT JOIN users u ON t.created_by = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.transaction_date ASC, t.created_at ASC`,
    params
  );
  return result.rows;
}

// GET /api/export/excel
router.get('/excel', authenticate, async (req, res) => {
  try {
    const { kasType, startDate, endDate, title } = req.query;
    const data = await getReportData({ kasType, startDate, endDate });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Jakarta Max Owners';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Laporan KAS', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
    });

    // Header organization info
    const orgTitle = 'JAKARTA MAX OWNERS';
    const reportTitle = title || `Laporan KAS ${kasType === 'kas_besar' ? 'Besar' : kasType === 'kas_kecil' ? 'Kecil' : 'Lengkap'}`;
    const period = startDate && endDate
      ? `Periode: ${moment(startDate).format('DD MMMM YYYY')} - ${moment(endDate).format('DD MMMM YYYY')}`
      : `Dicetak: ${moment().format('DD MMMM YYYY HH:mm')}`;

    ws.mergeCells('A1:I1');
    ws.getCell('A1').value = orgTitle;
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1E3A5F' } };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.mergeCells('A2:I2');
    ws.getCell('A2').value = reportTitle;
    ws.getCell('A2').font = { bold: true, size: 13, color: { argb: 'FF1E3A5F' } };
    ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 22;

    ws.mergeCells('A3:I3');
    ws.getCell('A3').value = period;
    ws.getCell('A3').font = { size: 10, color: { argb: 'FF666666' } };
    ws.getCell('A3').alignment = { horizontal: 'center' };
    ws.getRow(3).height = 18;

    // Empty row
    ws.getRow(4).height = 10;

    // Headers
    const headers = ['No', 'No. Transaksi', 'Tanggal', 'Jenis KAS', 'Kategori', 'Keterangan', 'No. Referensi', 'Pemasukan (Rp)', 'Pengeluaran (Rp)'];
    const colWidths = [5, 22, 14, 12, 18, 35, 16, 20, 20];

    ws.columns = colWidths.map((w, i) => ({ width: w, key: `col${i}` }));

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    headerRow.height = 22;

    let totalIncome = 0, totalExpense = 0;

    data.forEach((tx, idx) => {
      const isIncome = tx.transaction_type === 'income';
      const income = isIncome ? parseFloat(tx.amount) : null;
      const expense = !isIncome ? parseFloat(tx.amount) : null;
      if (income) totalIncome += income;
      if (expense) totalExpense += expense;

      const row = ws.addRow([
        idx + 1,
        tx.transaction_number,
        moment(tx.transaction_date).format('DD/MM/YYYY'),
        tx.kas_type === 'kas_besar' ? 'KAS BESAR' : 'KAS KECIL',
        tx.category_name || '-',
        tx.description,
        tx.reference_number || '-',
        income,
        expense
      ]);

      row.getCell(8).numFmt = '#,##0';
      row.getCell(9).numFmt = '#,##0';

      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          left: { style: 'thin', color: { argb: 'FFDDDDDD' } },
          right: { style: 'thin', color: { argb: 'FFDDDDDD' } }
        };
        if (colNum === 8) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F8F0' } };
        if (colNum === 9) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0F0' } };
        if ([8, 9].includes(colNum)) cell.alignment = { horizontal: 'right' };
      });

      if (idx % 2 === 0) {
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          if (![8, 9].includes(colNum)) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FF' } };
          }
        });
      }
      row.height = 18;
    });

    // Totals row
    const totalRow = ws.addRow(['', '', '', '', '', 'TOTAL', '', totalIncome, totalExpense]);
    totalRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      if ([8, 9].includes(colNum)) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });
    totalRow.height = 22;

    // Balance row
    const balance = totalIncome - totalExpense;
    const balRow = ws.addRow(['', '', '', '', '', 'SALDO', '', balance >= 0 ? balance : null, balance < 0 ? Math.abs(balance) : null]);
    balRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.font = { bold: true, color: { argb: balance >= 0 ? 'FF00695C' : 'FFC62828' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: balance >= 0 ? 'FFE0F2F1' : 'FFFFEBEE' } };
      if ([8, 9].includes(colNum)) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
    });
    balRow.height = 22;

    // Footer
    ws.addRow([]);
    ws.addRow(['', '', '', '', '', '', `Dicetak oleh sistem Jakarta Max Owners pada ${moment().format('DD MMMM YYYY HH:mm')}`]);

    const filename = `Laporan-KAS-JakartaMax-${moment().format('YYYYMMDD-HHmm')}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error generating Excel' });
  }
});

// GET /api/export/pdf
router.get('/pdf', authenticate, async (req, res) => {
  try {
    const { kasType, startDate, endDate, title } = req.query;
    const data = await getReportData({ kasType, startDate, endDate });

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const filename = `Laporan-KAS-JakartaMax-${moment().format('YYYYMMDD-HHmm')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const margin = 40;
    const contentW = pageW - margin * 2;

    // Header
    doc.rect(0, 0, pageW, 80).fill('#1E3A5F');
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
       .text('JAKARTA MAX OWNERS', margin, 18, { align: 'center', width: contentW });
    const rTitle = title || `Laporan KAS ${kasType === 'kas_besar' ? 'Besar' : kasType === 'kas_kecil' ? 'Kecil' : 'Lengkap'}`;
    doc.fontSize(11).text(rTitle, margin, 42, { align: 'center', width: contentW });
    const period = startDate && endDate
      ? `Periode: ${moment(startDate).format('DD MMMM YYYY')} - ${moment(endDate).format('DD MMMM YYYY')}`
      : `Dicetak: ${moment().format('DD MMMM YYYY HH:mm')}`;
    doc.fontSize(9).text(period, margin, 62, { align: 'center', width: contentW });

    let y = 95;

    // Table header
    const cols = [
      { label: 'No', w: 30, align: 'center' },
      { label: 'No. Transaksi', w: 120, align: 'left' },
      { label: 'Tanggal', w: 75, align: 'center' },
      { label: 'Jenis', w: 65, align: 'center' },
      { label: 'Kategori', w: 90, align: 'left' },
      { label: 'Keterangan', w: 155, align: 'left' },
      { label: 'Pemasukan', w: 85, align: 'right' },
      { label: 'Pengeluaran', w: 85, align: 'right' }
    ];

    // Draw header row
    doc.rect(margin, y, contentW, 20).fill('#1E3A5F');
    let x = margin;
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    cols.forEach(col => {
      doc.text(col.label, x + 3, y + 6, { width: col.w - 6, align: col.align });
      x += col.w;
    });
    y += 20;

    let totalIncome = 0, totalExpense = 0;
    doc.font('Helvetica').fontSize(7.5);

    data.forEach((tx, idx) => {
      if (y > doc.page.height - 80) {
        doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
        y = 40;
        // Redraw header
        doc.rect(margin, y, contentW, 20).fill('#1E3A5F');
        let hx = margin;
        doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
        cols.forEach(col => {
          doc.text(col.label, hx + 3, y + 6, { width: col.w - 6, align: col.align });
          hx += col.w;
        });
        y += 20;
        doc.font('Helvetica').fontSize(7.5);
      }

      const isIncome = tx.transaction_type === 'income';
      const amount = parseFloat(tx.amount);
      if (isIncome) totalIncome += amount; else totalExpense += amount;

      const rowH = 18;
      const bgColor = idx % 2 === 0 ? '#F8F9FF' : '#FFFFFF';
      doc.rect(margin, y, contentW, rowH).fill(bgColor);

      const rowData = [
        { v: String(idx + 1), w: cols[0].w, a: 'center' },
        { v: tx.transaction_number, w: cols[1].w, a: 'left' },
        { v: moment(tx.transaction_date).format('DD/MM/YYYY'), w: cols[2].w, a: 'center' },
        { v: tx.kas_type === 'kas_besar' ? 'KAS BESAR' : 'KAS KECIL', w: cols[3].w, a: 'center' },
        { v: (tx.category_name || '-').substring(0, 18), w: cols[4].w, a: 'left' },
        { v: tx.description.substring(0, 40), w: cols[5].w, a: 'left' },
        { v: isIncome ? formatCurrency(amount) : '-', w: cols[6].w, a: 'right' },
        { v: !isIncome ? formatCurrency(amount) : '-', w: cols[7].w, a: 'right' }
      ];

      let rx = margin;
      doc.fillColor('#333333');
      rowData.forEach(cell => {
        if (cell.v === formatCurrency(amount) && isIncome) doc.fillColor('#00695C');
        else if (cell.v === formatCurrency(amount) && !isIncome) doc.fillColor('#C62828');
        else doc.fillColor('#333333');
        doc.text(cell.v, rx + 3, y + 5, { width: cell.w - 6, align: cell.a });
        rx += cell.w;
      });

      // Row border
      doc.strokeColor('#DDDDDD').lineWidth(0.5)
         .moveTo(margin, y + rowH).lineTo(margin + contentW, y + rowH).stroke();

      y += rowH;
    });

    // Total row
    y += 5;
    doc.rect(margin, y, contentW, 22).fill('#1E3A5F');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
    const totalLabelX = margin + cols[0].w + cols[1].w + cols[2].w + cols[3].w + cols[4].w;
    doc.text('TOTAL', totalLabelX + 3, y + 7, { width: cols[5].w - 6, align: 'right' });
    const incomeX = totalLabelX + cols[5].w;
    const expX = incomeX + cols[6].w;
    doc.fillColor('#A5F3C6').text(formatCurrency(totalIncome), incomeX + 3, y + 7, { width: cols[6].w - 6, align: 'right' });
    doc.fillColor('#FFAAA5').text(formatCurrency(totalExpense), expX + 3, y + 7, { width: cols[7].w - 6, align: 'right' });
    y += 22;

    // Balance
    const balance = totalIncome - totalExpense;
    doc.rect(margin, y, contentW, 20).fill(balance >= 0 ? '#E0F2F1' : '#FFEBEE');
    doc.fillColor(balance >= 0 ? '#00695C' : '#C62828').font('Helvetica-Bold').fontSize(9);
    doc.text('SALDO AKHIR', totalLabelX + 3, y + 6, { width: cols[5].w - 6, align: 'right' });
    doc.text(formatCurrency(Math.abs(balance)), (balance >= 0 ? incomeX : expX) + 3, y + 6, { width: cols[6].w - 6, align: 'right' });
    y += 25;

    // Footer
    doc.fillColor('#999999').fontSize(8).font('Helvetica')
       .text(`Dokumen ini dicetak secara otomatis oleh sistem Jakarta Max Owners pada ${moment().format('DD MMMM YYYY HH:mm')}. Dokumen ini sah tanpa tanda tangan.`,
         margin, y, { width: contentW, align: 'center' });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error generating PDF' });
  }
});

module.exports = router;
