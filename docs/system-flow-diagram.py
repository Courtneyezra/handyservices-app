#!/usr/bin/env python3
"""
Handy Services — End-to-End System Flow Diagram
From initial contact through to contractor payment.
Branded with Handy Services colours.
"""

from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os, math

# ── Brand Colours ───────────────────────────────────────────────────────────
NAVY       = colors.HexColor('#1B2A4A')
YELLOW     = colors.HexColor('#F5A623')
WHITE      = colors.white
LIGHT_BG   = colors.HexColor('#F7F8FC')
MUTED      = colors.HexColor('#6B7280')
BORDER     = colors.HexColor('#D0D5E3')
GREEN      = colors.HexColor('#22C55E')
RED        = colors.HexColor('#EF4444')
AMBER      = colors.HexColor('#F59E0B')
BLUE       = colors.HexColor('#3B82F6')
PURPLE     = colors.HexColor('#8B5CF6')

# Status colours
BUILT      = colors.HexColor('#22C55E')  # Green
PARTIAL    = colors.HexColor('#F59E0B')  # Amber
MISSING    = colors.HexColor('#EF4444')  # Red

# ── Setup ───────────────────────────────────────────────────────────────────
OUTPUT = os.path.expanduser('~/v6-switchboard/docs/handy-services-system-flow.pdf')
W, H = landscape(A3)  # 420mm x 297mm
c = canvas.Canvas(OUTPUT, pagesize=landscape(A3))

# Try to register Poppins, fall back to Helvetica
try:
    FONT_DIR = "/usr/share/fonts/truetype/google-fonts"
    pdfmetrics.registerFont(TTFont('Poppins', f'{FONT_DIR}/Poppins-Regular.ttf'))
    pdfmetrics.registerFont(TTFont('Poppins-Bold', f'{FONT_DIR}/Poppins-Bold.ttf'))
    FONT = 'Poppins'
    FONT_B = 'Poppins-Bold'
except:
    FONT = 'Helvetica'
    FONT_B = 'Helvetica-Bold'


def draw_rounded_rect(x, y, w, h, r=4*mm, fill=WHITE, stroke=BORDER, stroke_w=0.5):
    """Draw a rounded rectangle."""
    c.setStrokeColor(stroke)
    c.setLineWidth(stroke_w)
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1)


def draw_box(x, y, w, h, title, items, status='built', accent=NAVY, icon=None):
    """Draw a system component box with status indicator."""
    status_color = BUILT if status == 'built' else (PARTIAL if status == 'partial' else MISSING)

    # Box background
    draw_rounded_rect(x, y, w, h, fill=WHITE, stroke=BORDER, stroke_w=0.75)

    # Status bar at top
    c.setFillColor(status_color)
    # Top strip
    c.roundRect(x, y + h - 6*mm, w, 6*mm, 4*mm, fill=1, stroke=0)
    # Fill bottom corners of strip
    c.rect(x, y + h - 6*mm, w, 3*mm, fill=1, stroke=0)

    # Status label
    c.setFillColor(WHITE)
    c.setFont(FONT_B, 6)
    status_text = 'BUILT' if status == 'built' else ('PARTIAL' if status == 'partial' else 'TO BUILD')
    c.drawCentredString(x + w/2, y + h - 5*mm, status_text)

    # Title
    c.setFillColor(NAVY)
    c.setFont(FONT_B, 8.5)
    title_y = y + h - 14*mm
    c.drawString(x + 4*mm, title_y, title)

    # Items
    c.setFont(FONT, 6.5)
    item_y = title_y - 10*mm
    for item in items:
        if item_y < y + 3*mm:
            break
        # Check/cross prefix
        if item.startswith('[x]'):
            c.setFillColor(MISSING)
            c.drawString(x + 4*mm, item_y, 'x')
            c.setFillColor(MUTED)
            c.drawString(x + 10*mm, item_y, item[4:])
        elif item.startswith('[!]'):
            c.setFillColor(AMBER)
            c.drawString(x + 4*mm, item_y, '!')
            c.setFillColor(MUTED)
            c.drawString(x + 10*mm, item_y, item[4:])
        else:
            c.setFillColor(BUILT)
            c.drawString(x + 4*mm, item_y, '+')
            c.setFillColor(MUTED)
            c.drawString(x + 10*mm, item_y, item)
        item_y -= 8*mm


def draw_arrow(x1, y1, x2, y2, color=NAVY, dashed=False):
    """Draw an arrow between two points."""
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.2)
    if dashed:
        c.setDash(3, 3)
    else:
        c.setDash()

    c.line(x1, y1, x2, y2)

    # Arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_len = 3*mm
    c.setDash()
    p = c.beginPath()
    p.moveTo(x2, y2)
    p.lineTo(x2 - arrow_len * math.cos(angle - 0.4),
             y2 - arrow_len * math.sin(angle - 0.4))
    p.lineTo(x2 - arrow_len * math.cos(angle + 0.4),
             y2 - arrow_len * math.sin(angle + 0.4))
    p.close()
    c.drawPath(p, fill=1, stroke=0)


def draw_connector_down(x, y1, y2, color=NAVY):
    """Vertical connector with arrow."""
    draw_arrow(x, y1, x, y2, color)


def draw_connector_right(x1, x2, y, color=NAVY):
    """Horizontal connector with arrow."""
    draw_arrow(x1, y, x2, y, color)


def draw_elbow(x1, y1, x2, y2, color=NAVY, dashed=False):
    """Draw an L-shaped connector."""
    c.setStrokeColor(color)
    c.setLineWidth(1.2)
    if dashed:
        c.setDash(3, 3)
    else:
        c.setDash()
    mid_x = x1
    c.line(x1, y1, x1, y2)
    c.line(x1, y2, x2, y2)
    c.setDash()
    # Arrowhead
    c.setFillColor(color)
    p = c.beginPath()
    p.moveTo(x2, y2)
    p.lineTo(x2 - 3*mm, y2 + 1.5*mm)
    p.lineTo(x2 - 3*mm, y2 - 1.5*mm)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 1 — MAIN FLOW (LEFT TO RIGHT)
# ═══════════════════════════════════════════════════════════════════════════

# Background
c.setFillColor(LIGHT_BG)
c.rect(0, 0, W, H, fill=1, stroke=0)

# Title bar
c.setFillColor(NAVY)
c.rect(0, H - 18*mm, W, 18*mm, fill=1, stroke=0)
c.setFillColor(WHITE)
c.setFont(FONT_B, 14)
c.drawString(10*mm, H - 13*mm, 'Handy Services — End-to-End System Flow')
c.setFont(FONT, 8)
c.setFillColor(YELLOW)
c.drawString(W - 120*mm, H - 11*mm, 'Initial Contact  >  Quote  >  Book  >  Assign  >  Execute  >  Pay')
c.setFont(FONT, 7)
c.setFillColor(colors.HexColor('#FFFFFF80'))
c.drawString(W - 120*mm, H - 15*mm, 'Green = Built   |   Amber = Partial   |   Red = To Build')

# Yellow accent strip
c.setFillColor(YELLOW)
c.rect(0, H - 20*mm, W, 2*mm, fill=1, stroke=0)

# ── Layout grid ─────────────────────────────────────────────────────────
# 10 columns across, 3 rows
margin_x = 8*mm
margin_y = 8*mm
top = H - 24*mm
box_w = 53*mm
box_h_main = 62*mm
box_h_portal = 55*mm
gap_x = 5*mm
gap_y = 8*mm

# ROW 1 — Main flow (y position)
row1_y = top - box_h_main - 2*mm

# Column positions
col = [margin_x + i * (box_w + gap_x) for i in range(8)]

# ── 1. INITIAL CONTACT ─────────────────────────────────────────────────
draw_box(col[0], row1_y, box_w, box_h_main,
    '1. Initial Contact',
    [
        'Inbound calls (Twilio)',
        'WhatsApp messages',
        'Website quote form',
        'AI call transcription',
        'Lead scoring + grading',
        'Segment detection',
        '[!] Auto follow-up missing',
    ],
    status='built', accent=GREEN)

# ── 2. VA QUOTE CREATION ──────────────────────────────────────────────
draw_box(col[1], row1_y, box_w, box_h_main,
    '2. VA Creates Quote',
    [
        'Ben enters line items',
        'Category per line item',
        'EVE contextual pricing',
        'Segment-based pricing',
        'Deposit calc (30% + materials)',
        '[!] No contractor pre-match',
        '[x] No skill coverage check',
        '[x] No margin preview',
    ],
    status='partial', accent=AMBER)

# ── 3. CUSTOMER VIEWS QUOTE ───────────────────────────────────────────
draw_box(col[2], row1_y, box_w, box_h_main,
    '3. Customer Views Quote',
    [
        'Personalised quote page',
        'Scope, pricing, value props',
        'PDF download',
        'View analytics tracked',
        '[!] Availability not skill-filtered',
        '[x] Dates not from contractors',
        '[x] No live availability',
    ],
    status='partial', accent=AMBER)

# ── 4. CUSTOMER BOOKS ─────────────────────────────────────────────────
draw_box(col[3], row1_y, box_w, box_h_main,
    '4. Customer Books',
    [
        'Stripe deposit payment',
        'Date/slot selection',
        'Full or instalment plan',
        '[!] No skill-filtered dates',
        '[!] No double-book guard',
        '[x] No confirmation email',
        '[x] No optimistic lock',
    ],
    status='partial', accent=AMBER)

# ── 5. CONTRACTOR ASSIGNED ────────────────────────────────────────────
draw_box(col[4], row1_y, box_w, box_h_main,
    '5. Contractor Assigned',
    [
        'Auto-assignment engine',
        'Skill matching (primary only!)',
        'Round-robin ranking',
        '[!] Matches 1st category only',
        '[!] No radius check',
        '[x] No day-before confirm',
        '[x] No re-assignment flow',
    ],
    status='partial', accent=AMBER)

# ── 6. JOB EXECUTION ─────────────────────────────────────────────────
draw_box(col[5], row1_y, box_w, box_h_main,
    '6. Job Execution',
    [
        'Contractor sees job details',
        'Status: in_progress',
        'Completion photos',
        'Notes + signature',
        '[x] No scope change flow',
        '[x] No customer live updates',
        '[x] No time tracking',
    ],
    status='partial', accent=AMBER)

# ── 7. INVOICE ────────────────────────────────────────────────────────
draw_box(col[6], row1_y, box_w, box_h_main,
    '7. Invoice & Payment',
    [
        'Invoice generation',
        'Balance = total - deposit',
        'Token-based public link',
        'Stripe / bank / cash',
        'PDF invoice',
        '[x] No auto-send email',
        '[x] No payment reminders',
    ],
    status='built', accent=GREEN)

# ── 8. CONTRACTOR PAYMENT ────────────────────────────────────────────
draw_box(col[7], row1_y, box_w, box_h_main,
    '8. Contractor Payment',
    [
        '[!] Manual payout only',
        '[x] No Stripe Connect',
        '[x] No auto weekly payout',
        '[x] No commission deduction',
        '[x] No WTBP rate card',
        '[x] No payout history',
        '[x] No tax reporting',
    ],
    status='missing', accent=RED)

# ── Arrows between main flow boxes ─────────────────────────────────────
for i in range(7):
    x1 = col[i] + box_w
    x2 = col[i + 1]
    y_mid = row1_y + box_h_main / 2
    draw_connector_right(x1 + 1*mm, x2 - 1*mm, y_mid, NAVY)

# ═══════════════════════════════════════════════════════════════════════
# ROW 2 — PORTALS + SUPPORTING SYSTEMS
# ═══════════════════════════════════════════════════════════════════════

row2_y = row1_y - box_h_portal - gap_y

# ── Customer Portal ───────────────────────────────────────────────────
portal_w = box_w * 2 + gap_x
draw_box(col[2], row2_y, portal_w, box_h_portal,
    'Customer Portal',
    [
        '[!] Invoice viewing only',
        '[x] No booking dashboard',
        '[x] No appointment tracker',
        '[x] No payment history',
        '[x] No communication thread',
        '[x] No document upload',
    ],
    status='missing')

# Arrow from booking down to customer portal
draw_connector_down(col[3] + box_w/2, row1_y - 1*mm, row2_y + box_h_portal + 1*mm, BLUE)

# ── Contractor Portal ─────────────────────────────────────────────────
draw_box(col[4], row2_y, portal_w, box_h_portal,
    'Contractor Portal',
    [
        'Dashboard + stats',
        'Job list + details',
        'Calendar view',
        'Booking accept/reject',
        'Expense tracking',
        'Settings + availability',
    ],
    status='built')

# Arrow from assignment down to contractor portal
draw_connector_down(col[5] + box_w/2, row1_y - 1*mm, row2_y + box_h_portal + 1*mm, PURPLE)

# ── Contractor Onboarding ────────────────────────────────────────────
draw_box(col[0], row2_y, portal_w, box_h_portal,
    'Contractor Onboarding',
    [
        '[!] /join page (marketing)',
        '[x] /contractor/welcome flow',
        '[x] Skill verification',
        '[x] WTBP rate card review',
        '[x] Availability setup wizard',
        '[x] Stripe Connect setup',
    ],
    status='missing')

# ── Amendments / Variations ──────────────────────────────────────────
draw_box(col[6], row2_y, portal_w, box_h_portal,
    'Amendments & Variations',
    [
        '[x] Quote edit re-matching',
        '[x] Scope change on-site',
        '[x] Variation orders',
        '[x] Price adjustment flow',
        '[x] Customer approval via link',
        '[x] Re-assignment on change',
    ],
    status='missing')

# Arrow from job execution down to amendments
draw_elbow(col[5] + box_w + 2*mm, row1_y + 10*mm, col[6] - 1*mm, row2_y + box_h_portal/2, AMBER, dashed=True)

# ═══════════════════════════════════════════════════════════════════════
# ROW 3 — DATA LAYER
# ═══════════════════════════════════════════════════════════════════════

row3_y = row2_y - 28*mm

# Data layer bar
c.setFillColor(NAVY)
c.roundRect(margin_x, row3_y, W - 2*margin_x, 22*mm, 3*mm, fill=1, stroke=0)
c.setFillColor(WHITE)
c.setFont(FONT_B, 8)
c.drawString(margin_x + 5*mm, row3_y + 15*mm, 'DATA LAYER')
c.setFont(FONT, 6.5)
c.setFillColor(YELLOW)

tables = [
    'leads', 'calls', 'conversations', 'personalizedQuotes',
    'contractorBookingRequests', 'contractorJobs', 'invoices',
    'handymanProfiles', 'handymanSkills', 'handymanAvailability',
    'paymentLinks', 'invoiceTokens',
]
tx = margin_x + 5*mm
for t in tables:
    c.drawString(tx, row3_y + 5*mm, t)
    tx += c.stringWidth(t, FONT, 6.5) + 8*mm
    if tx > W - 40*mm:
        break

# ═══════════════════════════════════════════════════════════════════════
# LEGEND
# ═══════════════════════════════════════════════════════════════════════

leg_x = margin_x
leg_y = row3_y - 14*mm
c.setFont(FONT_B, 7)
c.setFillColor(NAVY)
c.drawString(leg_x, leg_y, 'KEY:')

for i, (label, col_c) in enumerate([
    ('Built & functional', BUILT),
    ('Partial — needs work', PARTIAL),
    ('To build — missing', MISSING),
]):
    cx = leg_x + 20*mm + i * 55*mm
    c.setFillColor(col_c)
    c.circle(cx, leg_y + 2*mm, 2.5*mm, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont(FONT, 6.5)
    c.drawString(cx + 5*mm, leg_y, label)

# ═══════════════════════════════════════════════════════════════════════
# PAGE 2 — DETAILED FLOW WITH EDGE CASES
# ═══════════════════════════════════════════════════════════════════════
c.showPage()

# Background
c.setFillColor(LIGHT_BG)
c.rect(0, 0, W, H, fill=1, stroke=0)

# Title bar
c.setFillColor(NAVY)
c.rect(0, H - 18*mm, W, 18*mm, fill=1, stroke=0)
c.setFillColor(WHITE)
c.setFont(FONT_B, 14)
c.drawString(10*mm, H - 13*mm, 'Handy Services — Detailed Flow & Edge Cases')
c.setFillColor(YELLOW)
c.rect(0, H - 20*mm, W, 2*mm, fill=1, stroke=0)

# ── Swim lanes ──────────────────────────────────────────────────────────
lane_labels = ['Customer', 'VA (Ben)', 'System', 'Contractor']
lane_colors = [BLUE, AMBER, NAVY, PURPLE]
lane_h = (H - 30*mm) / 4
lane_start_y = H - 22*mm

for i, (label, lc) in enumerate(zip(lane_labels, lane_colors)):
    y = lane_start_y - (i + 1) * lane_h
    # Lane background
    bg = colors.HexColor('#F0F4FF') if i % 2 == 0 else WHITE
    c.setFillColor(bg)
    c.rect(30*mm, y, W - 32*mm, lane_h, fill=1, stroke=0)
    # Lane border
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.3)
    c.line(30*mm, y, W - 2*mm, y)
    # Lane label
    c.setFillColor(lc)
    c.roundRect(2*mm, y + lane_h/2 - 8*mm, 26*mm, 16*mm, 3*mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont(FONT_B, 7)
    c.drawCentredString(15*mm, y + lane_h/2 - 1*mm, label)

# ── Flow steps as small cards in swim lanes ─────────────────────────────

def swim_card(x, lane_idx, text, status='built', w=38*mm, h=14*mm):
    """Draw a small card in a swim lane."""
    y = lane_start_y - (lane_idx + 1) * lane_h + (lane_h - h) / 2
    status_color = BUILT if status == 'built' else (PARTIAL if status == 'partial' else MISSING)

    draw_rounded_rect(x, y, w, h, r=2*mm, fill=WHITE, stroke=status_color, stroke_w=1.5)

    # Text (word wrap simple)
    c.setFillColor(NAVY)
    c.setFont(FONT, 5.5)
    lines = text.split('\n')
    ty = y + h - 4.5*mm
    for line in lines:
        c.drawString(x + 2.5*mm, ty, line)
        ty -= 5*mm

    return x, y, w, h

# Column positions for flow steps
step_x = [35*mm + i * 48*mm for i in range(9)]

# Step 1: Customer contacts
s1 = swim_card(step_x[0], 0, 'Calls / WhatsApp /\nWebsite form', 'built')

# Step 2: Lead captured
s2 = swim_card(step_x[1], 2, 'Lead created\nAI scores & segments', 'built')

# Step 3: Ben creates quote
s3 = swim_card(step_x[2], 1, 'Creates line items\nCategory + price', 'built')

# Step 3b: System matches contractors
s3b = swim_card(step_x[2], 2, 'Pre-match contractors\nSkill + radius + margin', 'missing', w=38*mm)

# Step 4: Quote sent
s4 = swim_card(step_x[3], 0, 'Views quote page\nSees real dates', 'partial')

# Step 4b: System filters availability
s4b = swim_card(step_x[3], 2, 'Live availability\nSkill-filtered dates', 'missing')

# Step 5: Customer books
s5 = swim_card(step_x[4], 0, 'Selects date + pays\nDeposit collected', 'partial')

# Step 5b: System assigns
s5b = swim_card(step_x[4], 2, 'Auto-assign best\ncontractor match', 'partial')

# Step 6: Contractor accepts
s6 = swim_card(step_x[5], 3, 'Sees job in portal\nAccepts / declines', 'built')

# Step 6b: Day before confirm
s6b = swim_card(step_x[5], 2, 'Day-before WhatsApp\nconfirmation', 'missing')

# Step 7: Job execution
s7 = swim_card(step_x[6], 3, 'Does the work\nPhotos + notes', 'built')

# Step 7b: Customer updates
s7b = swim_card(step_x[6], 0, 'Live status updates\nCompletion notice', 'missing')

# Step 8: Invoice
s8 = swim_card(step_x[7], 2, 'Generate invoice\nBalance = total - deposit', 'built')

# Step 8b: Customer pays
s8b = swim_card(step_x[7], 0, 'Pays remaining\nbalance', 'built')

# Step 9: Contractor paid
s9 = swim_card(step_x[8], 3, 'WTBP rate paid\nWeekly payout', 'missing')

# Step 9b: Margin captured
s9b = swim_card(step_x[8], 2, 'Margin = customer\nprice - WTBP rate', 'missing')

# ── Draw connecting arrows between steps ────────────────────────────────
# Using simple horizontal arrows at varying heights
c.setDash()

# Horizontal flow arrows (simplified — connect rightward)
for i in range(8):
    x1 = step_x[i] + 38*mm + 1*mm
    x2 = step_x[i + 1] - 1*mm
    # Pick the lane where the arrow should flow
    y_mid = lane_start_y - 2.5 * lane_h  # System lane middle
    c.setStrokeColor(NAVY)
    c.setFillColor(NAVY)
    c.setLineWidth(0.8)
    c.line(x1, y_mid, x2, y_mid)
    # Small arrowhead
    p = c.beginPath()
    p.moveTo(x2, y_mid)
    p.lineTo(x2 - 2*mm, y_mid + 1*mm)
    p.lineTo(x2 - 2*mm, y_mid - 1*mm)
    p.close()
    c.drawPath(p, fill=1, stroke=0)

# ── Edge case callouts ──────────────────────────────────────────────────
def callout(x, y, text, color=RED):
    """Small edge case warning."""
    c.setFillColor(color)
    c.setFont(FONT_B, 4.5)
    c.drawString(x, y, text)

# Edge cases near relevant steps
callout(step_x[2], lane_start_y - 2*lane_h - 2*mm, 'BUG: Matches ANY category, not ALL', RED)
callout(step_x[4] - 5*mm, lane_start_y - 2*lane_h - 2*mm, 'BUG: Primary category only', RED)
callout(step_x[3], lane_start_y - 2*lane_h - 8*mm, 'MISSING: Radius check in availability', RED)
callout(step_x[5], lane_start_y - 2*lane_h - 2*mm, 'MISSING: No-show confirmation', AMBER)
callout(step_x[7], lane_start_y - 4*lane_h + 2*mm, 'MISSING: Stripe Connect payouts', RED)


# ═══════════════════════════════════════════════════════════════════════
# PAGE 3 — PRICING MODEL: CUSTOMER EVE vs CONTRACTOR WTBP
# ═══════════════════════════════════════════════════════════════════════
c.showPage()

c.setFillColor(LIGHT_BG)
c.rect(0, 0, W, H, fill=1, stroke=0)

# Title
c.setFillColor(NAVY)
c.rect(0, H - 18*mm, W, 18*mm, fill=1, stroke=0)
c.setFillColor(WHITE)
c.setFont(FONT_B, 14)
c.drawString(10*mm, H - 13*mm, 'Handy Services — Pricing Model: Customer EVE vs Contractor WTBP')
c.setFillColor(YELLOW)
c.rect(0, H - 20*mm, W, 2*mm, fill=1, stroke=0)

# ── Left side: Customer EVE ─────────────────────────────────────────────
left_x = 15*mm
mid_x = W / 2
right_x = mid_x + 10*mm
section_w = mid_x - 25*mm

cy = H - 35*mm
c.setFillColor(BLUE)
c.setFont(FONT_B, 12)
c.drawString(left_x, cy, 'Customer Side: EVE')
c.setFont(FONT, 8)
c.setFillColor(MUTED)
cy -= 10*mm
c.drawString(left_x, cy, 'Price = Reference Price + Differentiator Value')

cy -= 15*mm
c.setFillColor(NAVY)
c.setFont(FONT_B, 9)
c.drawString(left_x, cy, 'Reference Price (Nottingham market rate)')
c.setFont(FONT, 7)
cy -= 9*mm

ref_prices = [
    ('General fixing', '£35-45/hr'),
    ('Carpentry', '£35-50/hr'),
    ('Painting', '£30-45/hr'),
    ('Plumbing (minor)', '£40-65/hr'),
    ('Electrical (minor)', '£45-70/hr'),
]

for label, price in ref_prices:
    c.setFillColor(MUTED)
    c.drawString(left_x + 5*mm, cy, label)
    c.setFillColor(NAVY)
    c.drawString(left_x + 70*mm, cy, price)
    cy -= 8*mm

cy -= 5*mm
c.setFillColor(NAVY)
c.setFont(FONT_B, 9)
c.drawString(left_x, cy, 'Differentiator Value (customer pays MORE for)')
c.setFont(FONT, 7)
cy -= 9*mm

diffs = [
    ('Speed / next-day slots', '+£10-15/hr'),
    ('Trust (insured, DBS, reviews)', '+£8-12/hr'),
    ('Deposit protection', '+£3-5/hr'),
    ('Photo proof of work', '+£3-5/hr'),
    ('Tenant coordination', '+£5-8/hr'),
]

for label, val in diffs:
    c.setFillColor(MUTED)
    c.drawString(left_x + 5*mm, cy, label)
    c.setFillColor(GREEN)
    c.drawString(left_x + 70*mm, cy, val)
    cy -= 8*mm

# ── Right side: Contractor WTBP ─────────────────────────────────────────
cy = H - 35*mm
c.setFillColor(PURPLE)
c.setFont(FONT_B, 12)
c.drawString(right_x, cy, 'Contractor Side: WTBP')
c.setFont(FONT, 8)
c.setFillColor(MUTED)
cy -= 10*mm
c.drawString(right_x, cy, 'Rate = Solo Effective Earnings - Value We Provide')

cy -= 15*mm
c.setFillColor(NAVY)
c.setFont(FONT_B, 9)
c.drawString(right_x, cy, 'Solo Effective Rate (after dead time)')
c.setFont(FONT, 7)
cy -= 9*mm

solo_rates = [
    ('General (charges £40, bills 50%)', '~£20/hr effective'),
    ('Carpentry (charges £45, bills 50%)', '~£22/hr effective'),
    ('Painting (charges £38, bills 55%)', '~£21/hr effective'),
    ('Plumbing (charges £55, bills 45%)', '~£25/hr effective'),
    ('Electrical (charges £60, bills 45%)', '~£27/hr effective'),
]

for label, rate in solo_rates:
    c.setFillColor(MUTED)
    c.drawString(right_x + 5*mm, cy, label)
    c.setFillColor(NAVY)
    c.drawString(right_x + 85*mm, cy, rate)
    cy -= 8*mm

cy -= 5*mm
c.setFillColor(NAVY)
c.setFont(FONT_B, 9)
c.drawString(right_x, cy, 'Value We Provide (contractor accepts LESS for)')
c.setFont(FONT, 7)
cy -= 9*mm

our_value = [
    ('No quoting time (30-45min/job saved)', '-£12-18/hr'),
    ('No payment chasing', '-£5-10/hr'),
    ('No marketing / platform fees', '-£2-5/hr'),
    ('Geographic routing (less travel)', '-£5-8/hr'),
    ('No-show deposit protection', '-£3-5/hr'),
    ('Guaranteed pipeline (no cold weeks)', 'Psychological'),
]

for label, val in our_value:
    c.setFillColor(MUTED)
    c.drawString(right_x + 5*mm, cy, label)
    c.setFillColor(RED)
    c.drawString(right_x + 85*mm, cy, val)
    cy -= 8*mm

# ── Centre: Margin Table ────────────────────────────────────────────────
table_y = cy - 15*mm
c.setFillColor(NAVY)
c.setFont(FONT_B, 11)
c.drawCentredString(W / 2, table_y + 10*mm, 'THE MARGIN = Customer EVE Price - Contractor WTBP Rate')

# Table
table_x = 40*mm
table_w = W - 80*mm
row_h = 10*mm
cols = [table_x, table_x + 55*mm, table_x + 110*mm, table_x + 165*mm, table_x + 220*mm, table_x + 275*mm]

headers = ['Category', 'Customer EVE', 'Contractor WTBP', 'AM Slot Earn', 'Your Margin', 'Margin %']
data = [
    ['General Fixing', '~£45/hr', '£22/hr', '£88/AM', '£23/hr', '51%'],
    ['Carpentry', '~£51/hr', '£25/hr', '£100/AM', '£26/hr', '51%'],
    ['Painting', '~£45/hr', '£20/hr', '£80/AM', '£25/hr', '56%'],
    ['Plumbing (minor)', '~£58/hr', '£30/hr', '£120/AM', '£28/hr', '48%'],
    ['Electrical (minor)', '~£64/hr', '£35/hr', '£140/AM', '£29/hr', '45%'],
]

# Header row
header_y = table_y - 5*mm
c.setFillColor(NAVY)
c.roundRect(table_x - 3*mm, header_y - 2*mm, table_w + 6*mm, row_h + 2*mm, 2*mm, fill=1, stroke=0)
c.setFillColor(WHITE)
c.setFont(FONT_B, 7)
for i, h in enumerate(headers):
    c.drawString(cols[i], header_y + 1*mm, h)

# Data rows
for r, row in enumerate(data):
    ry = header_y - (r + 1) * row_h
    bg = WHITE if r % 2 == 0 else LIGHT_BG
    c.setFillColor(bg)
    c.rect(table_x - 3*mm, ry - 2*mm, table_w + 6*mm, row_h, fill=1, stroke=0)

    c.setFont(FONT, 7)
    for i, val in enumerate(row):
        if i == 4 or i == 5:  # Margin columns
            c.setFillColor(GREEN)
            c.setFont(FONT_B, 7)
        elif i == 2 or i == 3:  # WTBP columns
            c.setFillColor(PURPLE)
            c.setFont(FONT, 7)
        elif i == 1:  # EVE column
            c.setFillColor(BLUE)
            c.setFont(FONT, 7)
        else:
            c.setFillColor(NAVY)
            c.setFont(FONT, 7)
        c.drawString(cols[i], ry + 1*mm, val)

# Bottom note
note_y = header_y - (len(data) + 1) * row_h - 5*mm
c.setFillColor(MUTED)
c.setFont(FONT, 6)
c.drawCentredString(W/2, note_y, 'Contractor WTBP Rate = MAX(Mathematical floor, Psychological floor, Recruitment competitiveness floor)')
c.drawCentredString(W/2, note_y - 8*mm, 'AM Slot = 4 hours of work. Contractor sees per-job rates, not hourly. Faster = more jobs = more earnings.')


# ═══════════════════════════════════════════════════════════════════════
# Save
# ═══════════════════════════════════════════════════════════════════════
c.save()
print(f'Generated: {OUTPUT}')
