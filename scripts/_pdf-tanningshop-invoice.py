#!/usr/bin/env python3
"""
Branded INVOICE PDF for The Tanning Shop Beechdale (INV-2026-0181).
Uses the handy-services-pdf brand template (navy + yellow + Poppins).

Bank details: HANDY NETWORK LTD (corrected — was Handyman Nottingham).
Output: ~/Downloads/INV-2026-0181-TheTanningShop.pdf

Safe to delete after running.
"""
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Image as RLImage,
    Paragraph, Spacer, HRFlowable,
)

# ---------- Local asset paths (skill expects /mnt/... — we override) ----------
HOME = os.path.expanduser('~')
FONT_DIR = os.path.join(HOME, 'v6-switchboard', 'scripts', '_fonts')
LOGO = os.path.join(
    HOME,
    'Library/Application Support/Claude/local-agent-mode-sessions/'
    'skills-plugin/28b47369-9e8a-4d10-9998-5d34ca05aee3/'
    '1656b4c2-e79d-4206-bfa5-50c3e0744680/skills/handy-services-pdf/assets/logo.png'
)

pdfmetrics.registerFont(TTFont('Poppins',        f'{FONT_DIR}/Poppins-Regular.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-Bold',   f'{FONT_DIR}/Poppins-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-Medium', f'{FONT_DIR}/Poppins-Medium.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-Light',  f'{FONT_DIR}/Poppins-Light.ttf'))
pdfmetrics.registerFont(TTFont('Poppins-Italic', f'{FONT_DIR}/Poppins-Italic.ttf'))

# ---------- Brand palette ----------
NAVY   = colors.HexColor('#1B2A4A')
YELLOW = colors.HexColor('#F5A623')
WHITE  = colors.white
LIGHT  = colors.HexColor('#F7F8FC')
MID    = colors.HexColor('#D0D5E3')
DARK   = colors.HexColor('#111827')
MUTED  = colors.HexColor('#6B7280')
YELLOW_SOFT = colors.HexColor('#FFF8EC')


def ps(name, font='Poppins', size=10, color=DARK, align=TA_LEFT,
       leading=None, before=0, after=4, **kw):
    return ParagraphStyle(
        name, fontName=font, fontSize=size, textColor=color,
        alignment=align, leading=leading or size * 1.5,
        spaceBefore=before, spaceAfter=after, **kw,
    )


# ---------- Invoice data ----------
INVOICE_NUMBER = 'INV-2026-0181'
INVOICE_DATE   = date.today().strftime('%d %B %Y')
DUE_DATE       = date.today().strftime('%d %B %Y')  # NET 0 — same day

BILL_TO_LINES = [
    '<b>The Tanning Shop Beechdale Nottingham</b>',
    'Unit 2, Beechdale Retail Park',
    'Nottingham NG8 3LL',
    'United Kingdom',
    '+44 115 929 3594',
]

LINE_ITEMS = [
    {
        'description': 'Refix door ironmongery securely — ensure door closes correctly',
        'qty': 1,
        'unit': 120.00,
    },
]
SUBTOTAL = sum(li['qty'] * li['unit'] for li in LINE_ITEMS)
DEPOSIT  = 0.00
BALANCE  = SUBTOTAL - DEPOSIT

OUT_PATH = os.path.join(HOME, 'Downloads', f'{INVOICE_NUMBER}-TheTanningShop.pdf')


# ---------- Document setup ----------
doc = SimpleDocTemplate(
    OUT_PATH, pagesize=A4,
    topMargin=0, bottomMargin=14*mm, leftMargin=20*mm, rightMargin=20*mm,
)
W = 170*mm
story = []


# --- 1. Nav bar (acts as topMargin) ---
nav_logo = RLImage(LOGO, width=10*mm, height=8.4*mm)
nav_data = [[
    nav_logo,
    Paragraph('<b><font color="#FFFFFF">Handy Services</font></b>',
              ps('nb', 'Poppins-Bold', 13, WHITE)),
    Paragraph(
        '<font color="#F5A623">★★★★★</font> <font color="#FFFFFF">4.9 from 300+ Reviews</font>',
        ps('nr', 'Poppins', 8.5, WHITE)),
    Paragraph('<font color="#FFFFFF">07449 501 762</font>',
              ps('np', 'Poppins-Bold', 10, WHITE, align=TA_RIGHT)),
]]
nav_table = Table(nav_data, colWidths=[12*mm, 45*mm, 78*mm, 35*mm])
nav_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), NAVY),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 8),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ('LEFTPADDING', (0, 0), (0, 0), 8),
    ('LEFTPADDING', (1, 0), (1, 0), 4),
]))
story.append(nav_table)

# --- 2. Yellow accent strip (says "INVOICE INV-2026-0181") ---
strip_data = [[Paragraph(
    f'<font color="#1B2A4A"><b>⚡ INVOICE &nbsp;·&nbsp; {INVOICE_NUMBER}</b></font>',
    ps('strip', 'Poppins-Bold', 9, NAVY, align=TA_CENTER))]]
strip_table = Table(strip_data, colWidths=[W])
strip_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), YELLOW),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
]))
story.append(strip_table)
story.append(Spacer(1, 8*mm))

# --- 3. Hero title block ---
story.append(Paragraph('Invoice', ps('h1', 'Poppins-Bold', 30, NAVY, after=2)))
story.append(Paragraph(
    f'<font color="#F5A623"><b>£{BALANCE:,.2f} due</b></font>',
    ps('h1y', 'Poppins-Bold', 24, YELLOW, after=4)))
story.append(Paragraph(
    f'Prepared for <b>The Tanning Shop Beechdale</b> &nbsp;·&nbsp; '
    f'Nottingham &nbsp;·&nbsp; {INVOICE_DATE}',
    ps('sub', 'Poppins-Light', 11, MUTED, after=10)))

# --- 4. Credential badges ---
badge_data = [[
    "✓  £2M Public Liability", "★  4.9 Google (300+ reviews)",
    "✓  DBS Checked", "⚡  Next-Day Slots",
]]
badge_table = Table(badge_data, colWidths=[43*mm, 52*mm, 36*mm, 36*mm])
badge_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), NAVY),
    ('FONTNAME', (0, 0), (-1, -1), 'Poppins-Bold'),
    ('FONTSIZE', (0, 0), (-1, -1), 8),
    ('TEXTCOLOR', (0, 0), (-1, -1), WHITE),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 7),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ('LINEAFTER', (0, 0), (2, 0), 0.5, YELLOW),
]))
story.append(badge_table)
story.append(Spacer(1, 8*mm))

# --- 5. Bill To + Invoice Meta two-column block ---
bill_to_html = '<br/>'.join(BILL_TO_LINES)
bill_to_para = Paragraph(
    f'<font color="#6B7280" size="8"><b>BILL TO</b></font><br/>'
    f'<font color="#111827" size="10">{bill_to_html}</font>',
    ps('billto', 'Poppins', 10, DARK, leading=15),
)
meta_para = Paragraph(
    f'<font color="#6B7280" size="8"><b>INVOICE DETAILS</b></font><br/>'
    f'<font color="#111827" size="10">'
    f'<b>Number:</b> {INVOICE_NUMBER}<br/>'
    f'<b>Issued:</b> {INVOICE_DATE}<br/>'
    f'<b>Due:</b> {DUE_DATE}<br/>'
    f'<b>Terms:</b> Payable on receipt'
    f'</font>',
    ps('meta', 'Poppins', 10, DARK, align=TA_RIGHT, leading=15),
)
two_col = Table([[bill_to_para, meta_para]], colWidths=[100*mm, 70*mm])
two_col.setStyle(TableStyle([
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 8),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
]))
story.append(two_col)
story.append(Spacer(1, 6*mm))

# --- 6. Section: Line items ---
story.append(Paragraph('Work Carried Out', ps('sec', 'Poppins-Bold', 12, NAVY, before=4, after=4)))
story.append(HRFlowable(width="100%", thickness=2, color=YELLOW, spaceAfter=6))

li_header = [['Description', 'Qty', 'Unit Price', 'Total']]
li_rows = [
    [
        Paragraph(item['description'], ps('liDesc', 'Poppins', 9.5, DARK, leading=14)),
        f"{item['qty']}",
        f"£{item['unit']:,.2f}",
        f"£{item['qty'] * item['unit']:,.2f}",
    ]
    for item in LINE_ITEMS
]
li_table = Table(li_header + li_rows, colWidths=[100*mm, 14*mm, 28*mm, 28*mm])
li_table.setStyle(TableStyle([
    # header
    ('BACKGROUND', (0, 0), (-1, 0), NAVY),
    ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
    ('FONTNAME', (0, 0), (-1, 0), 'Poppins-Bold'),
    ('FONTSIZE', (0, 0), (-1, 0), 9),
    ('ALIGN', (1, 0), (1, -1), 'CENTER'),
    ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
    ('TOPPADDING', (0, 0), (-1, 0), 8),
    ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
    # body
    ('FONTNAME', (0, 1), (-1, -1), 'Poppins'),
    ('FONTSIZE', (0, 1), (-1, -1), 9.5),
    ('TEXTCOLOR', (0, 1), (-1, -1), DARK),
    ('VALIGN', (0, 1), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 1), (-1, -1), 10),
    ('BOTTOMPADDING', (0, 1), (-1, -1), 10),
    ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT]),
    ('LINEBELOW', (0, 0), (-1, -1), 0.5, MID),
]))
story.append(li_table)
story.append(Spacer(1, 6*mm))

# --- 7. Totals block (right-aligned) ---
totals_inner_rows = [
    ['Subtotal', f'£{SUBTOTAL:,.2f}'],
]
if DEPOSIT > 0:
    totals_inner_rows.append([
        Paragraph('<font color="#16a34a">Deposit paid</font>',
                  ps('dep', 'Poppins', 10, colors.HexColor('#16a34a'))),
        Paragraph(f'<font color="#16a34a">-£{DEPOSIT:,.2f}</font>',
                  ps('depv', 'Poppins', 10, colors.HexColor('#16a34a'), align=TA_RIGHT)),
    ])
totals_inner_rows.append([
    Paragraph('<b>Balance Due</b>', ps('balL', 'Poppins-Bold', 12, NAVY)),
    Paragraph(f'<b>£{BALANCE:,.2f}</b>',
              ps('balR', 'Poppins-Bold', 14, NAVY, align=TA_RIGHT)),
])
totals_inner = Table(totals_inner_rows, colWidths=[55*mm, 35*mm])
totals_inner.setStyle(TableStyle([
    ('FONTNAME', (0, 0), (-1, -2), 'Poppins'),
    ('FONTSIZE', (0, 0), (-1, -2), 10),
    ('TEXTCOLOR', (0, 0), (-1, -2), DARK),
    ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ('TOPPADDING', (0, 0), (-1, -1), 5),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ('LINEABOVE', (0, -1), (-1, -1), 1.5, NAVY),
]))
# Push totals to the right
totals_wrap = Table([[None, totals_inner]], colWidths=[80*mm, 90*mm])
totals_wrap.setStyle(TableStyle([
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
]))
story.append(totals_wrap)
story.append(Spacer(1, 8*mm))

# --- 8. Payment / BACS section ---
story.append(Paragraph('How to Pay', ps('sec2', 'Poppins-Bold', 12, NAVY, before=4, after=4)))
story.append(HRFlowable(width="100%", thickness=2, color=YELLOW, spaceAfter=6))

bacs_para = Paragraph(
    '<b>Bank Transfer (BACS)</b><br/>'
    '<br/>'
    'Account Name: <b>HANDY NETWORK LTD</b><br/>'
    'Sort Code: <b>04-00-06</b><br/>'
    'Account Number: <b>76360634</b><br/>'
    f'Payment Reference: <b>{INVOICE_NUMBER}</b><br/>'
    f'<br/>'
    f'<font color="#6B7280" size="8.5">Please use the invoice number as your payment reference '
    f'so we can match the payment to your account.</font>',
    ps('bacs', 'Poppins', 10, NAVY, leading=15),
)
bacs_table = Table([[bacs_para]], colWidths=[W])
bacs_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), YELLOW_SOFT),
    ('BOX', (0, 0), (-1, -1), 0.5, YELLOW),
    ('LINEAFTER', (0, 0), (0, -1), 4, YELLOW),
    ('TOPPADDING', (0, 0), (-1, -1), 14),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
    ('LEFTPADDING', (0, 0), (-1, -1), 16),
    ('RIGHTPADDING', (0, 0), (-1, -1), 14),
]))
story.append(bacs_table)
story.append(Spacer(1, 10*mm))

# --- 9. Thank-you note ---
story.append(Paragraph(
    'Thank you for trusting Handy Services with your maintenance — '
    'we genuinely appreciate the work and look forward to helping again. '
    'Any questions about this invoice, please get in touch.',
    ps('thanks', 'Poppins-Italic', 9.5, MUTED, leading=15, after=8),
))

# --- 10. Footer ---
footer_logo = RLImage(LOGO, width=10*mm, height=8.4*mm)
footer_data = [[
    footer_logo,
    Paragraph(
        "<b><font color='#FFFFFF'>Handy Services</font></b><br/>"
        "<font color='#F5A623'>Next-day slots &middot; Fast &amp; reliable &middot; Fully insured</font>",
        ps('fl', 'Poppins', 9, WHITE, leading=15),
    ),
    Paragraph(
        "<font color='#FFFFFF'><b>Get in Touch</b><br/>"
        "07449 501 762<br/>hello@handyservices.uk</font>",
        ps('fr', 'Poppins', 9, WHITE, align=TA_RIGHT, leading=15),
    ),
]]
footer_table = Table(footer_data, colWidths=[14*mm, 90*mm, 66*mm])
footer_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), NAVY),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 12),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
    ('LEFTPADDING', (0, 0), (0, 0), 10),
    ('LEFTPADDING', (1, 0), (1, 0), 6),
    ('RIGHTPADDING', (-1, -1), (-1, -1), 12),
]))
story.append(footer_table)


# ---------- Render ----------
doc.build(story)
size_kb = os.path.getsize(OUT_PATH) / 1024
print(f'Saved: {OUT_PATH} ({size_kb:.1f} KB)')
