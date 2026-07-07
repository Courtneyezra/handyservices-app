x!/usr/bin/env python3
"""Generate Handy Services Partner Opportunity PDF - Branded"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Frame
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import os

# Brand colors
NAVY = HexColor('#1e293b')
DARK_NAVY = HexColor('#0f172a')
GOLD = HexColor('#FBBF24')
GREEN = HexColor('#7DB00E')
WHITE = HexColor('#ffffff')
SLATE_300 = HexColor('#cbd5e1')
SLATE_400 = HexColor('#94a3b8')
SLATE_500 = HexColor('#64748b')
SLATE_700 = HexColor('#334155')

W, H = A4
MARGIN = 20 * mm

LOGO_PATH = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'logo.png')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), 'Handy_Services_Partner_Opportunity.pdf')


def draw_bg(c, color=DARK_NAVY):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def draw_footer(c, page_num, total=6):
    # Footer line
    c.setStrokeColor(SLATE_700)
    c.setLineWidth(0.5)
    c.line(MARGIN, 18 * mm, W - MARGIN, 18 * mm)
    # Left text
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 7)
    c.drawString(MARGIN, 13 * mm, "Handy Services  |  handyservices.app  |  07449 501762")
    # Center
    c.drawCentredString(W / 2, 13 * mm, "Confidential - Partner Opportunity")
    # Right
    c.drawRightString(W - MARGIN, 13 * mm, f"Page {page_num} of {total}")


def draw_gold_bar(c, y, width=40 * mm):
    c.setFillColor(GOLD)
    c.roundRect(MARGIN, y, width, 3, 1.5, fill=1, stroke=0)
    return y - 5 * mm


def draw_section_header(c, y, text):
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(MARGIN, y, text.upper())
    y -= 3 * mm
    c.setStrokeColor(GOLD)
    c.setLineWidth(1)
    c.line(MARGIN, y, MARGIN + c.stringWidth(text.upper(), "Helvetica-Bold", 8) + 5 * mm, y)
    return y - 8 * mm


def draw_bullet(c, x, y, text, bold_prefix=None, font_size=9.5, text_color=SLATE_300):
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y, "\u2022")
    text_x = x + 6 * mm
    if bold_prefix:
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", font_size)
        c.drawString(text_x, y, bold_prefix)
        text_x += c.stringWidth(bold_prefix, "Helvetica-Bold", font_size) + 1 * mm
        c.setFillColor(text_color)
        c.setFont("Helvetica", font_size)
        c.drawString(text_x, y, text)
    else:
        c.setFillColor(text_color)
        c.setFont("Helvetica", font_size)
        c.drawString(text_x, y, text)
    return y - 6 * mm


def draw_card(c, x, y, w, h, title, bullets, icon_text=None):
    # Card background
    c.setFillColor(SLATE_700)
    c.roundRect(x, y - h, w, h, 3 * mm, fill=1, stroke=0)

    # Gold top accent
    c.setFillColor(GOLD)
    c.roundRect(x, y - 2, w, 2, 1, fill=1, stroke=0)

    inner_y = y - 8 * mm
    if icon_text:
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 14)
        c.drawString(x + 5 * mm, inner_y, icon_text)
        inner_y -= 6 * mm

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 5 * mm, inner_y, title)
    inner_y -= 7 * mm

    for bullet in bullets:
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 8)
        c.drawString(x + 5 * mm, inner_y, "\u2022  " + bullet)
        inner_y -= 5 * mm

    return y - h - 5 * mm


def page_cover(c):
    draw_bg(c, DARK_NAVY)

    # Top accent bar
    c.setFillColor(GOLD)
    c.rect(0, H - 4 * mm, W, 4 * mm, fill=1, stroke=0)

    # Logo
    if os.path.exists(LOGO_PATH):
        c.drawImage(LOGO_PATH, MARGIN, H - 35 * mm, width=30 * mm, height=30 * mm,
                     preserveAspectRatio=True, mask='auto')

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(MARGIN + 35 * mm, H - 28 * mm, "Handy Services")

    # Main title area - centered vertically
    y = H * 0.62

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, y + 15 * mm, "PARTNER OPPORTUNITY")

    draw_gold_bar(c, y + 10 * mm, 50 * mm)

    # Main headline
    style_main = ParagraphStyle(
        'main', fontName='Helvetica-Bold', fontSize=34, leading=40,
        textColor=WHITE, alignment=TA_LEFT
    )
    p = Paragraph("Build Your<br/>Business.", style_main)
    f = Frame(MARGIN, y - 45 * mm, W - 2 * MARGIN, 55 * mm, showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f.addFromList([p], c)

    style_sub = ParagraphStyle(
        'sub', fontName='Helvetica', fontSize=34, leading=40,
        textColor=GOLD, alignment=TA_LEFT
    )
    p2 = Paragraph("We Build The<br/>Machine Around You.", style_sub)
    f2 = Frame(MARGIN, y - 95 * mm, W - 2 * MARGIN, 55 * mm, showBoundary=0,
               leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f2.addFromList([p2], c)

    # Tagline
    y_tag = y - 108 * mm
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 12)
    c.drawString(MARGIN, y_tag, "Nottingham's fastest growing property services team")

    # Trust badges
    y_badge = y_tag - 20 * mm
    badges = ["4.9 from 300+ Reviews", "DBS Checked", "Fully Insured", "Next-Day Service"]
    bx = MARGIN
    for badge in badges:
        c.setFillColor(SLATE_700)
        bw = c.stringWidth(badge, "Helvetica", 8) + 10 * mm
        c.roundRect(bx, y_badge - 2 * mm, bw, 8 * mm, 2 * mm, fill=1, stroke=0)
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 7)
        c.drawString(bx + 3 * mm, y_badge + 0.5 * mm, "\u2713")
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 8)
        c.drawString(bx + 7 * mm, y_badge + 0.5 * mm, badge)
        bx += bw + 3 * mm

    # Bottom confidential
    c.setFillColor(SLATE_500)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 25 * mm, "CONFIDENTIAL DOCUMENT  |  APRIL 2026")

    draw_footer(c, 1)


def page_opportunity(c):
    draw_bg(c, DARK_NAVY)

    # Gold top accent
    c.setFillColor(GOLD)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    y = H - 25 * mm
    y = draw_section_header(c, y, "The Opportunity")

    # Main question
    style_q = ParagraphStyle(
        'question', fontName='Helvetica-Bold', fontSize=20, leading=26,
        textColor=WHITE, alignment=TA_LEFT
    )
    p = Paragraph("What if you could run a handyman business<br/>without the hassle?", style_q)
    f = Frame(MARGIN, y - 30 * mm, W - 2 * MARGIN, 35 * mm, showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f.addFromList([p], c)
    y -= 40 * mm

    # Two column layout
    col_w = (W - 2 * MARGIN - 10 * mm) / 2

    # LEFT: We Handle
    lx = MARGIN
    ly = y

    c.setFillColor(SLATE_700)
    c.roundRect(lx, ly - 75 * mm, col_w, 75 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(lx + 5 * mm, ly - 8 * mm, "We Handle")

    we_items = [
        "All customer acquisition & marketing",
        "Fixed-price quoting (AI-powered)",
        "Booking & scheduling",
        "Customer service & complaints",
        "Payment collection",
        "Brand & reputation management"
    ]
    iy = ly - 18 * mm
    for item in we_items:
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(lx + 5 * mm, iy, "\u2713")
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 9)
        c.drawString(lx + 12 * mm, iy, item)
        iy -= 8 * mm

    # RIGHT: You Handle
    rx = MARGIN + col_w + 10 * mm

    c.setFillColor(SLATE_700)
    c.roundRect(rx, ly - 75 * mm, col_w, 75 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(rx + 5 * mm, ly - 8 * mm, "You Handle")

    you_items = [
        "Turning up and doing great work",
        "Building your team over time",
        "Maintaining quality standards",
        "Diagnostic site visits (complex jobs)",
    ]
    iy = ly - 18 * mm
    for item in you_items:
        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(rx + 5 * mm, iy, "\u2022")
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 9)
        c.drawString(rx + 12 * mm, iy, item)
        iy -= 8 * mm

    y = ly - 85 * mm

    # Highlight quote
    c.setFillColor(GOLD)
    c.roundRect(MARGIN, y - 18 * mm, W - 2 * MARGIN, 18 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(DARK_NAVY)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, y - 7 * mm, "No cold calling. No quoting. No chasing payments.")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, y - 14 * mm, "Just great work, well paid.")

    y -= 30 * mm

    # What makes this different section
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "What makes this different?")
    y -= 10 * mm

    diffs = [
        ("Fixed prices, not hourly: ", "Customers see the price before they book. No awkward negotiations."),
        ("AI-powered quoting: ", "Our system generates accurate fixed quotes from job descriptions and photos."),
        ("You're a partner, not a subbie: ", "You grow a business with us, not just take orders."),
        ("48-hour payment: ", "Job complete, photos uploaded, paid within 48 hours."),
    ]
    for bold, text in diffs:
        y = draw_bullet(c, MARGIN, y, text, bold_prefix=bold, font_size=9)

    draw_footer(c, 2)


def page_how_it_works(c):
    draw_bg(c, DARK_NAVY)

    c.setFillColor(GOLD)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    y = H - 25 * mm
    y = draw_section_header(c, y, "How It Works")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, "Three channels feed your pipeline")
    y -= 5 * mm
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN, y, "Your work comes from multiple sources - and it compounds over time.")
    y -= 15 * mm

    # Channel cards
    card_w = (W - 2 * MARGIN - 10 * mm) / 3
    card_h = 55 * mm

    # Card 1 - New Leads
    cx = MARGIN
    c.setFillColor(SLATE_700)
    c.roundRect(cx, y - card_h, card_w, card_h, 3 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.roundRect(cx, y - 1, card_w, 2, 1, fill=1, stroke=0)

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(cx + 5 * mm, y - 10 * mm, "01")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(cx + 5 * mm, y - 18 * mm, "New Customer Leads")
    c.setFillColor(SLATE_300)
    c.setFont("Helvetica", 8)
    lines1 = ["Google Ads, SEO,", "referrals & website", "bookings drive fresh", "customers to your zone."]
    ly = y - 26 * mm
    for line in lines1:
        c.drawString(cx + 5 * mm, ly, line)
        ly -= 4.5 * mm

    # Card 2 - Repeat
    cx = MARGIN + card_w + 5 * mm
    c.setFillColor(SLATE_700)
    c.roundRect(cx, y - card_h, card_w, card_h, 3 * mm, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.roundRect(cx, y - 1, card_w, 2, 1, fill=1, stroke=0)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(cx + 5 * mm, y - 10 * mm, "02")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(cx + 5 * mm, y - 18 * mm, "Repeat Customers")
    c.setFillColor(SLATE_300)
    c.setFont("Helvetica", 8)
    lines2 = ["Every happy customer", "comes back. No acquisition", "cost. They ask for you", "by name."]
    ly = y - 26 * mm
    for line in lines2:
        c.drawString(cx + 5 * mm, ly, line)
        ly -= 4.5 * mm

    # Card 3 - Landlord
    cx = MARGIN + 2 * (card_w + 5 * mm)
    c.setFillColor(SLATE_700)
    c.roundRect(cx, y - card_h, card_w, card_h, 3 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.roundRect(cx, y - 1, card_w, 2, 1, fill=1, stroke=0)

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(cx + 5 * mm, y - 10 * mm, "03")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(cx + 5 * mm, y - 18 * mm, "Landlord Platform")
    c.setFillColor(SLATE_300)
    c.setFont("Helvetica", 8)
    lines3 = ["Landlords onboard once.", "Tenant maintenance flows", "via AI triage. 1 landlord,", "3 properties = 15-45", "jobs/year."]
    ly = y - 26 * mm
    for line in lines3:
        c.drawString(cx + 5 * mm, ly, line)
        ly -= 4.5 * mm

    y -= card_h + 12 * mm

    # Compounding visual
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "Your pipeline compounds every month")
    y -= 12 * mm

    # Timeline bars
    months = [
        ("Month 1", 12, 0, 0, "12 jobs"),
        ("Month 3", 15, 4, 3, "22 jobs"),
        ("Month 6", 15, 8, 10, "33 jobs"),
        ("Month 12", 18, 15, 25, "58 jobs"),
    ]

    max_jobs = 58
    bar_area_w = W - 2 * MARGIN - 55 * mm - 25 * mm

    for label, new, repeat, landlord, total_label in months:
        total = new + repeat + landlord

        c.setFillColor(SLATE_300)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(MARGIN, y, label)

        bar_x = MARGIN + 30 * mm

        # New leads bar
        new_w = (new / max_jobs) * bar_area_w
        c.setFillColor(GOLD)
        c.roundRect(bar_x, y - 1 * mm, max(new_w, 2), 6 * mm, 1, fill=1, stroke=0)

        # Repeat bar
        repeat_w = (repeat / max_jobs) * bar_area_w
        if repeat > 0:
            c.setFillColor(GREEN)
            c.roundRect(bar_x + new_w, y - 1 * mm, max(repeat_w, 2), 6 * mm, 1, fill=1, stroke=0)

        # Landlord bar
        landlord_w = (landlord / max_jobs) * bar_area_w
        if landlord > 0:
            c.setFillColor(HexColor('#3b82f6'))
            c.roundRect(bar_x + new_w + repeat_w, y - 1 * mm, max(landlord_w, 2), 6 * mm, 1, fill=1, stroke=0)

        # Total label
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(bar_x + new_w + repeat_w + landlord_w + 3 * mm, y, total_label)

        y -= 12 * mm

    # Legend
    y -= 2 * mm
    legend = [("New Leads", GOLD), ("Repeat Customers", GREEN), ("Landlord Platform", HexColor('#3b82f6'))]
    lx = MARGIN + 30 * mm
    for label, color in legend:
        c.setFillColor(color)
        c.roundRect(lx, y, 4 * mm, 4 * mm, 1, fill=1, stroke=0)
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 8)
        c.drawString(lx + 6 * mm, y + 0.5 * mm, label)
        lx += c.stringWidth(label, "Helvetica", 8) + 14 * mm

    y -= 15 * mm

    # Quote
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, y, '"Your pipeline compounds. Month 1 might be 12 jobs.')
    y -= 6 * mm
    c.drawString(MARGIN, y, 'By month 6 you could be looking at 30+."')

    draw_footer(c, 3)


def page_growth_path(c):
    draw_bg(c, DARK_NAVY)

    c.setFillColor(GOLD)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    y = H - 25 * mm
    y = draw_section_header(c, y, "The Growth Path")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, "From tradesperson to business owner")
    y -= 5 * mm
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN, y, "A clear path off the tools. At your pace.")
    y -= 18 * mm

    phases = [
        {
            "num": "01",
            "title": "Prove It",
            "timeline": "Month 1-3",
            "color": GOLD,
            "bullets": [
                "You on the tools, supported by your team",
                "10-15 jobs per week sent to your zone",
                "Learn the system, build the rhythm",
                "All quoting, booking & payments handled by us",
                "Paid within 48 hours of each completed job",
            ]
        },
        {
            "num": "02",
            "title": "Build The Team",
            "timeline": "Month 3-6",
            "color": GREEN,
            "bullets": [
                "Start putting your team on simpler jobs",
                "You take the multi-skill & high-value work",
                "Volume grows to 15-20 jobs per week",
                "Your income grows as your team delivers more",
            ]
        },
        {
            "num": "03",
            "title": "Come Off The Tools",
            "timeline": "Month 6-12",
            "color": GOLD,
            "bullets": [
                "Your team of 3-4 handling 20-25 jobs per week",
                "You manage quality, diagnostics & your people",
                "Only pick up tools for premium or complex jobs",
                "Income decouples from your personal hours",
            ]
        },
        {
            "num": "04",
            "title": "Scale",
            "timeline": "Month 12+",
            "color": GREEN,
            "bullets": [
                "Potential second zone or territory",
                "Running a proper operation",
                "Income grows with your team, not your hours",
                "Founding partner benefits as the network grows",
            ]
        },
    ]

    for phase in phases:
        # Phase container
        container_h = 8 * mm + len(phase["bullets"]) * 6 * mm + 5 * mm

        c.setFillColor(SLATE_700)
        c.roundRect(MARGIN, y - container_h, W - 2 * MARGIN, container_h, 3 * mm, fill=1, stroke=0)

        # Left accent bar
        c.setFillColor(phase["color"])
        c.roundRect(MARGIN, y - container_h, 4 * mm, container_h, 2 * mm, fill=1, stroke=0)

        # Phase number and title
        inner_x = MARGIN + 10 * mm
        c.setFillColor(phase["color"])
        c.setFont("Helvetica-Bold", 14)
        c.drawString(inner_x, y - 7 * mm, phase["num"])

        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(inner_x + 12 * mm, y - 7 * mm, phase["title"])

        # Timeline badge
        c.setFillColor(DARK_NAVY)
        tw = c.stringWidth(phase["timeline"], "Helvetica", 8) + 6 * mm
        c.roundRect(W - MARGIN - tw - 5 * mm, y - 9 * mm, tw, 7 * mm, 2 * mm, fill=1, stroke=0)
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 8)
        c.drawString(W - MARGIN - tw - 2 * mm, y - 6.5 * mm, phase["timeline"])

        # Bullets
        by = y - 16 * mm
        for bullet in phase["bullets"]:
            c.setFillColor(phase["color"])
            c.setFont("Helvetica", 8)
            c.drawString(inner_x + 12 * mm, by, "\u2022")
            c.setFillColor(SLATE_300)
            c.setFont("Helvetica", 9)
            c.drawString(inner_x + 17 * mm, by, bullet)
            by -= 6 * mm

        y -= container_h + 5 * mm

    draw_footer(c, 4)


def page_numbers(c):
    draw_bg(c, DARK_NAVY)

    c.setFillColor(GOLD)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    y = H - 25 * mm
    y = draw_section_header(c, y, "The Numbers")

    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, "Illustrative earnings trajectory")
    y -= 5 * mm
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN, y, "Based on average ticket of ~£180. Actual results depend on job mix and volume.")
    y -= 15 * mm

    # Earnings table
    rows = [
        ("", "Jobs/month", "Revenue", "Your 70%", "Team costs", "Your profit"),
        ("Month 1", "12", "£2,160", "£1,512", "£0", "£1,512"),
        ("Month 3", "22", "£3,960", "£2,772", "£0", "£2,772"),
        ("Month 6", "33", "£5,940", "£4,158", "-£1,600", "£2,558"),
        ("Month 12", "58", "£10,440", "£7,308", "-£3,200", "£4,108"),
    ]

    col_widths = [30 * mm, 25 * mm, 25 * mm, 25 * mm, 25 * mm, 30 * mm]
    row_h = 9 * mm

    for ri, row in enumerate(rows):
        rx = MARGIN
        for ci, cell in enumerate(row):
            if ri == 0:
                # Header row
                c.setFillColor(SLATE_700)
                c.rect(rx, y - row_h, col_widths[ci], row_h, fill=1, stroke=0)
                c.setFillColor(GOLD)
                c.setFont("Helvetica-Bold", 8)
            elif ri == len(rows) - 1:
                # Last row highlight
                c.setFillColor(HexColor('#1a2e1a'))
                c.rect(rx, y - row_h, col_widths[ci], row_h, fill=1, stroke=0)
                if ci == len(row) - 1:
                    c.setFillColor(GREEN)
                    c.setFont("Helvetica-Bold", 9)
                elif ci == 0:
                    c.setFillColor(WHITE)
                    c.setFont("Helvetica-Bold", 9)
                else:
                    c.setFillColor(SLATE_300)
                    c.setFont("Helvetica", 9)
            else:
                if ri % 2 == 0:
                    c.setFillColor(HexColor('#1e2a3b'))
                else:
                    c.setFillColor(DARK_NAVY)
                c.rect(rx, y - row_h, col_widths[ci], row_h, fill=1, stroke=0)
                if ci == 0:
                    c.setFillColor(WHITE)
                    c.setFont("Helvetica-Bold", 9)
                elif ci == len(row) - 1:
                    c.setFillColor(GREEN)
                    c.setFont("Helvetica-Bold", 9)
                else:
                    c.setFillColor(SLATE_300)
                    c.setFont("Helvetica", 9)

            c.drawString(rx + 3 * mm, y - row_h + 3 * mm, cell)
            rx += col_widths[ci]
        y -= row_h

    y -= 12 * mm

    # Highlight box
    c.setFillColor(GOLD)
    c.roundRect(MARGIN, y - 15 * mm, W - 2 * MARGIN, 15 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(DARK_NAVY)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, y - 6 * mm, "By month 12, you could be earning £4,000+/month")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, y - 12 * mm, "without picking up a tool.")

    y -= 28 * mm

    # Key terms
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "Key Terms")
    y -= 12 * mm

    terms = [
        ("Revenue split: ", "70/30 - you keep 70% of every job"),
        ("Payment: ", "Within 48 hours of verified job completion"),
        ("Franchise fee: ", "None for founding partners"),
        ("Lock-in: ", "No lock-in during trial period"),
        ("Your own clients: ", "Keep your own work on your off-days"),
        ("Team costs: ", "You employ your own team - their cost, your margin"),
    ]

    for bold, text in terms:
        y = draw_bullet(c, MARGIN, y, text, bold_prefix=bold, font_size=9.5)

    y -= 8 * mm

    # Note
    c.setFillColor(SLATE_700)
    c.roundRect(MARGIN, y - 18 * mm, W - 2 * MARGIN, 18 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(SLATE_400)
    c.setFont("Helvetica", 8)
    style_note = ParagraphStyle(
        'note', fontName='Helvetica', fontSize=8, leading=11,
        textColor=SLATE_400, alignment=TA_LEFT
    )
    p = Paragraph(
        "All figures are illustrative and based on current market rates and job volumes in Nottingham. "
        "Actual earnings will depend on job mix, seasonal demand, team size and performance. "
        "These projections are not guaranteed.",
        style_note
    )
    f = Frame(MARGIN + 5 * mm, y - 17 * mm, W - 2 * MARGIN - 10 * mm, 16 * mm, showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f.addFromList([p], c)

    draw_footer(c, 5)


def page_why_handy(c):
    draw_bg(c, DARK_NAVY)

    c.setFillColor(GOLD)
    c.rect(0, H - 3 * mm, W, 3 * mm, fill=1, stroke=0)

    y = H - 25 * mm
    y = draw_section_header(c, y, "Why Handy Services")

    # Market gap
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(MARGIN, y, "The market gap is real")
    y -= 12 * mm

    c.setFillColor(SLATE_700)
    c.roundRect(MARGIN, y - 30 * mm, W - 2 * MARGIN, 30 * mm, 3 * mm, fill=1, stroke=0)

    style_quote = ParagraphStyle(
        'quote', fontName='Helvetica', fontSize=10, leading=14,
        textColor=SLATE_300, alignment=TA_LEFT
    )
    p = Paragraph(
        "Fantastic Services - the UK's biggest home services company with 530 franchisees and "
        "a £35M platform - tried handyman and essentially gave up. Their handyman entity is "
        "dormant on Companies House. Why? Their system was built for cleaning. "
        "<b><font color='#FBBF24'>Ours is built specifically for multi-skilled tradespeople.</font></b>",
        style_quote
    )
    f = Frame(MARGIN + 5 * mm, y - 29 * mm, W - 2 * MARGIN - 10 * mm, 28 * mm, showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f.addFromList([p], c)

    y -= 42 * mm

    # Tech advantages
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "Our technology advantage")
    y -= 12 * mm

    techs = [
        ("AI-Powered Quoting", "Contextual fixed prices generated from\njob descriptions and photos"),
        ("Price Before Booking", "Customers see the exact price\nbefore they commit"),
        ("Multi-Trade Handling", "One quote handles plumbing + carpentry\n+ tiling as a single package"),
        ("Landlord Platform", "AI triage routes tenant maintenance\nrequests directly to you"),
        ("Job Briefs", "Materials list, access notes & customer\ndetails sent the night before"),
        ("Quality Evidence", "Photos, signatures & time tracking\non every job"),
    ]

    col_w = (W - 2 * MARGIN - 15 * mm) / 2
    col = 0
    start_y = y

    for i, (title, desc) in enumerate(techs):
        if i == 3:
            col = 1
            y = start_y

        cx = MARGIN + col * (col_w + 15 * mm)

        c.setFillColor(GOLD)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(cx, y, title)
        y -= 5 * mm
        c.setFillColor(SLATE_300)
        c.setFont("Helvetica", 8.5)
        for line in desc.split('\n'):
            c.drawString(cx, y, line)
            y -= 4 * mm
        y -= 8 * mm

    y -= 5 * mm

    # Bottom statement
    c.setFillColor(SLATE_700)
    c.roundRect(MARGIN, y - 32 * mm, W - 2 * MARGIN, 32 * mm, 3 * mm, fill=1, stroke=0)

    # Gold left accent
    c.setFillColor(GOLD)
    c.roundRect(MARGIN, y - 32 * mm, 4 * mm, 32 * mm, 2 * mm, fill=1, stroke=0)

    style_final = ParagraphStyle(
        'final', fontName='Helvetica-Bold', fontSize=12, leading=17,
        textColor=WHITE, alignment=TA_LEFT
    )
    p = Paragraph(
        "We're not a lead generation platform. We're not an agency.<br/>"
        "<font color='#FBBF24'>We're building the infrastructure that lets great "
        "tradespeople become great business owners.</font>",
        style_final
    )
    f = Frame(MARGIN + 10 * mm, y - 31 * mm, W - 2 * MARGIN - 15 * mm, 30 * mm, showBoundary=0,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    f.addFromList([p], c)

    y -= 45 * mm

    # Next step
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "Interested?")
    y -= 8 * mm
    c.setFillColor(SLATE_300)
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN, y, "This is an informal conversation. No commitment required.")
    y -= 6 * mm
    c.drawString(MARGIN, y, "Let's grab a coffee and talk about whether this could work for you.")
    y -= 12 * mm

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, y, "07449 501762  |  handyservices.app")

    draw_footer(c, 6)


def main():
    c = canvas.Canvas(OUTPUT_PATH, pagesize=A4)
    c.setTitle("Handy Services - Partner Opportunity")
    c.setAuthor("Handy Services")
    c.setSubject("Partner Opportunity - Confidential")

    page_cover(c)
    c.showPage()

    page_opportunity(c)
    c.showPage()

    page_how_it_works(c)
    c.showPage()

    page_growth_path(c)
    c.showPage()

    page_numbers(c)
    c.showPage()

    page_why_handy(c)
    c.showPage()

    c.save()
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
