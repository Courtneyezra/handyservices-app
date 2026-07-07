x!/usr/bin/env python3
"""Generate Handy Services Partner Opportunity PDF"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Paragraph, Frame, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
import os

# Brand colors
NAVY = HexColor('#1e293b')
DARK_NAVY = HexColor('#0f172a')
GOLD = HexColor('#FBBF24')
GREEN = HexColor('#7DB00E')
LIGHT_GREY = HexColor('#f1f5f9')
MID_GREY = HexColor('#94a3b8')
DARK_TEXT = HexColor('#1e293b')
WHITE = HexColor('#ffffff')
SLATE_700 = HexColor('#334155')
SLATE_50 = HexColor('#f8fafc')

W, H = A4
MARGIN = 25 * mm

logo_path = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'logo.png')

def draw_header_bar(c, y, text, color=NAVY):
    """Draw a section header bar"""
    c.setFillColor(color)
    c.roundRect(MARGIN, y - 2 * mm, W - 2 * MARGIN, 10 * mm, 2 * mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN + 5 * mm, y + 1.5 * mm, text.upper())
    return y - 15 * mm


def draw_bullet(c, x, y, text, bold_prefix=None, font_size=9.5):
    """Draw a bullet point"""
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(x, y, "\u2022")
    if bold_prefix:
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica-Bold", font_size)
        c.drawString(x + 5 * mm, y, bold_prefix)
        prefix_width = c.stringWidth(bold_prefix, "Helvetica-Bold", font_size)
        c.setFont("Helvetica", font_size)
        c.drawString(x + 5 * mm + prefix_width, y, " " + text)
    else:
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica", font_size)
        c.drawString(x + 5 * mm, y, text)
    return y - 5.5 * mm


def draw_stat_box(c, x, y, w, number, label, bg=SLATE_50, accent=GREEN):
    """Draw a stat box"""
    c.setFillColor(bg)
    c.roundRect(x, y, w, 22 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(x + w / 2, y + 12 * mm, number)
    c.setFillColor(SLATE_700)
    c.setFont("Helvetica", 7.5)
    c.drawCentredString(x + w / 2, y + 4 * mm, label)


def draw_gold_divider(c, y):
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.5)
    c.line(MARGIN, y, W - MARGIN, y)
    return y - 3 * mm


# ============================================================
# PAGE 1 - COVER
# ============================================================
def page_cover(c):
    # Full navy background
    c.setFillColor(DARK_NAVY)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Gold accent bar at top
    c.setFillColor(GOLD)
    c.rect(0, H - 8 * mm, W, 8 * mm, fill=1, stroke=0)

    # Logo
    if os.path.exists(logo_path):
        c.drawImage(logo_path, W / 2 - 22 * mm, H - 85 * mm, 44 * mm, 44 * mm,
                     preserveAspectRatio=True, mask='auto')

    # Company name
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(W / 2, H - 105 * mm, "Handy Services")

    # Gold line
    c.setStrokeColor(GOLD)
    c.setLineWidth(2)
    c.line(W / 2 - 40 * mm, H - 112 * mm, W / 2 + 40 * mm, H - 112 * mm)

    # Title
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(W / 2, H - 130 * mm, "Partner Opportunity")

    # Subtitle
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 12)
    c.drawCentredString(W / 2, H - 142 * mm, "Build Your Business. Come Off The Tools.")

    # Key propositions in boxes
    props = [
        ("Guaranteed Work Pipeline", "Three revenue channels feeding your zone"),
        ("Fixed-Price Quoting", "We handle all pricing and customer communication"),
        ("Path Off The Tools", "Build a team, grow your income, step back from grafting"),
        ("Proven Technology", "Booking, quoting, and job management platform included"),
    ]

    box_y = H - 175 * mm
    for title, desc in props:
        # Box background
        c.setFillColor(HexColor('#1a2638'))
        c.roundRect(MARGIN + 10 * mm, box_y - 2 * mm, W - 2 * MARGIN - 20 * mm, 18 * mm, 3 * mm, fill=1, stroke=0)

        # Gold left accent
        c.setFillColor(GOLD)
        c.roundRect(MARGIN + 10 * mm, box_y - 2 * mm, 3 * mm, 18 * mm, 1.5 * mm, fill=1, stroke=0)

        # Title
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawString(MARGIN + 18 * mm, box_y + 8 * mm, title)

        # Description
        c.setFillColor(MID_GREY)
        c.setFont("Helvetica", 8.5)
        c.drawString(MARGIN + 18 * mm, box_y + 1 * mm, desc)

        box_y -= 23 * mm

    # Footer
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, 25 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app")

    # Bottom gold bar
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)


# ============================================================
# PAGE 2 - THE OPPORTUNITY
# ============================================================
def page_opportunity(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Header strip
    c.setFillColor(NAVY)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    if os.path.exists(logo_path):
        c.drawImage(logo_path, 12 * mm, H - 15.5 * mm, 13 * mm, 13 * mm,
                     preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(28 * mm, H - 13 * mm, "The Opportunity")
    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 12 * mm, H - 13 * mm, "Handy Services Partner Programme")

    y = H - 35 * mm

    # Opening paragraph
    c.setFillColor(DARK_TEXT)
    c.setFont("Helvetica", 10)

    style_body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=14,
                                 textColor=DARK_TEXT, spaceAfter=3 * mm)
    style_bold = ParagraphStyle('bold_body', fontName='Helvetica-Bold', fontSize=9.5,
                                 leading=14, textColor=DARK_TEXT)

    text = """Handy Services is Nottingham's fastest-growing property services company. We've built the
    marketing engine, the technology platform, and the customer base. Now we need the right partner
    to own a zone and grow with us."""
    p = Paragraph(text, style_body)
    pw, ph = p.wrap(W - 2 * MARGIN, 100 * mm)
    p.drawOn(c, MARGIN, y - ph)
    y -= ph + 5 * mm

    text2 = """We're looking for an experienced, multi-skilled tradesperson who wants to stop being
    a one-man band and start building a real business - with a guaranteed pipeline of work,
    professional branding, and a clear path off the tools."""
    p2 = Paragraph(text2, style_body)
    pw, ph = p2.wrap(W - 2 * MARGIN, 100 * mm)
    p2.drawOn(c, MARGIN, y - ph)
    y -= ph + 8 * mm

    # The Market Gap section
    y = draw_header_bar(c, y, "Why Now? The Market Gap")
    y += 2 * mm

    text3 = """Fantastic Services - the UK's largest home services franchise (530+ franchisees,
    50,000+ reviews) - <b>tried handyman services and essentially gave up</b>. Their handyman
    subsidiary is dormant on Companies House. Why? Because their model is built for cleaning:
    standardised, hourly-rate, low-skill work. Handyman is the opposite - bespoke, multi-trade,
    and impossible to standardise with their approach."""
    p3 = Paragraph(text3, style_body)
    pw, ph = p3.wrap(W - 2 * MARGIN, 100 * mm)
    p3.drawOn(c, MARGIN, y - ph)
    y -= ph + 5 * mm

    text4 = """<b>Our approach is different.</b> Instead of standardising the service (impossible for trades),
    we standardise the <b>pricing and customer experience</b>. Our AI-powered quoting engine generates
    fixed prices for bespoke jobs - something no competitor offers at scale. The customer sees a clear
    price before they book. You do what you do best - the work."""
    p4 = Paragraph(text4, style_body)
    pw, ph = p4.wrap(W - 2 * MARGIN, 100 * mm)
    p4.drawOn(c, MARGIN, y - ph)
    y -= ph + 8 * mm

    # Stats bar
    box_w = (W - 2 * MARGIN - 10 * mm) / 3
    draw_stat_box(c, MARGIN, y - 22 * mm, box_w, "4.9", "Google Rating (300+ Reviews)")
    draw_stat_box(c, MARGIN + box_w + 5 * mm, y - 22 * mm, box_w, "300+", "Homeowners Served")
    draw_stat_box(c, MARGIN + 2 * (box_w + 5 * mm), y - 22 * mm, box_w, "#1", "Nottingham Handyman")
    y -= 35 * mm

    # What We Provide
    y = draw_header_bar(c, y, "What We Provide")
    y += 2 * mm

    items = [
        ("Customers: ", "All leads generated through our marketing, SEO, Google Ads, and referrals"),
        ("Quoting: ", "AI-powered fixed-price quotes sent to customers within minutes"),
        ("Booking: ", "Online booking system with deposit collection and scheduling"),
        ("Landlord Platform: ", "Direct pipeline of recurring maintenance work from landlord clients"),
        ("Brand: ", "Professional branding, branded workwear, van signage"),
        ("Payments: ", "We collect from customers and pay you within 48 hours of job completion"),
        ("Technology: ", "Contractor app for job management, photos, time tracking, and invoicing"),
        ("Customer Service: ", "We handle all customer enquiries, complaints, and follow-ups"),
    ]

    for bold, text in items:
        y = draw_bullet(c, MARGIN + 2 * mm, y, text, bold)

    y -= 8 * mm

    # What We're Looking For
    y = draw_header_bar(c, y, "What We're Looking For")
    y += 2 * mm

    reqs = [
        "Multi-skilled tradesperson (plumbing, carpentry, tiling, general repairs)",
        "Existing small team or willingness to build one",
        "Committed to quality workmanship and professional standards",
        "Available 3-4 days per week minimum",
        "DBS checked, fully insured, own tools and transport",
        "Ambition to grow from tradesperson to business owner",
    ]
    for r in reqs:
        y = draw_bullet(c, MARGIN + 2 * mm, y, r)

    # Footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 8 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app  |  Page 2")


# ============================================================
# PAGE 3 - THREE REVENUE CHANNELS
# ============================================================
def page_revenue(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Header strip
    c.setFillColor(NAVY)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    if os.path.exists(logo_path):
        c.drawImage(logo_path, 12 * mm, H - 15.5 * mm, 13 * mm, 13 * mm,
                     preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(28 * mm, H - 13 * mm, "Your Work Pipeline")
    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 12 * mm, H - 13 * mm, "Three Channels. One Pipeline. Compounding.")

    y = H - 32 * mm

    style_body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=14,
                                 textColor=DARK_TEXT)

    intro = """Unlike working for yourself where every job starts from zero, our model gives you three
    sources of work that <b>compound over time</b>. The longer you're with us, the more work flows in -
    without spending more on marketing."""
    p = Paragraph(intro, style_body)
    pw, ph = p.wrap(W - 2 * MARGIN, 50 * mm)
    p.drawOn(c, MARGIN, y - ph)
    y -= ph + 8 * mm

    # Channel 1
    channels = [
        {
            "num": "01",
            "title": "New Customer Leads",
            "color": GREEN,
            "desc": "Google Ads, SEO, WhatsApp enquiries, referrals, and direct calls. We generate the "
                     "leads, qualify them, and send you fixed-price quoted jobs ready to book.",
            "metric": "10-18 jobs/month",
            "icon": "Acquisition cost: ours, not yours"
        },
        {
            "num": "02",
            "title": "Repeat Customers",
            "color": GOLD,
            "desc": "Every happy customer comes back. Fix someone's tap in March, they call for shelves "
                     "in June. They ask for you by name. This channel grows every single month with zero "
                     "additional marketing spend.",
            "metric": "Grows 3-5 jobs/month after Month 3",
            "icon": "Zero acquisition cost"
        },
        {
            "num": "03",
            "title": "Landlord Platform",
            "color": HexColor('#3b82f6'),
            "desc": "Our AI-powered landlord maintenance platform (handyservices.app/landlord) "
                     "automatically triages tenant maintenance requests and creates priced jobs. One "
                     "landlord with 3 properties = 15-45 jobs per year. This is steady, recurring work "
                     "that never dries up.",
            "metric": "10-25 jobs/month by Month 6",
            "icon": "Recurring. Predictable. Year-round."
        },
    ]

    for ch in channels:
        # Channel box
        c.setFillColor(SLATE_50)
        c.roundRect(MARGIN, y - 42 * mm, W - 2 * MARGIN, 42 * mm, 3 * mm, fill=1, stroke=0)

        # Left color accent
        c.setFillColor(ch["color"])
        c.roundRect(MARGIN, y - 42 * mm, 4 * mm, 42 * mm, 2 * mm, fill=1, stroke=0)

        # Number
        c.setFillColor(ch["color"])
        c.setFont("Helvetica-Bold", 22)
        c.drawString(MARGIN + 9 * mm, y - 10 * mm, ch["num"])

        # Title
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(MARGIN + 25 * mm, y - 10 * mm, ch["title"])

        # Description
        desc_style = ParagraphStyle('ch_desc', fontName='Helvetica', fontSize=8.5, leading=12,
                                     textColor=SLATE_700)
        p = Paragraph(ch["desc"], desc_style)
        pw, ph = p.wrap(W - 2 * MARGIN - 35 * mm, 25 * mm)
        p.drawOn(c, MARGIN + 25 * mm, y - 15 * mm - ph)

        # Metric badge
        c.setFillColor(ch["color"])
        metric_w = c.stringWidth(ch["metric"], "Helvetica-Bold", 8) + 8 * mm
        c.roundRect(MARGIN + 25 * mm, y - 38 * mm, metric_w, 7 * mm, 2 * mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(MARGIN + 29 * mm, y - 35.5 * mm, ch["metric"])

        # Sub-label
        c.setFillColor(MID_GREY)
        c.setFont("Helvetica-Oblique", 7.5)
        c.drawString(MARGIN + 30 * mm + metric_w, y - 35.5 * mm, "   " + ch["icon"])

        y -= 48 * mm

    # Combined growth projection
    y -= 2 * mm
    y = draw_header_bar(c, y, "Combined Pipeline Growth")
    y += 2 * mm

    # Growth table
    table_data = [
        ["", "Month 1", "Month 3", "Month 6", "Month 12"],
        ["New Leads", "12", "15", "15", "18"],
        ["Repeat Customers", "0", "4", "8", "15"],
        ["Landlord Platform", "0", "3", "10", "25"],
        ["Total Jobs/Month", "12", "22", "33", "58"],
        ["Jobs/Week", "3", "5", "8", "14"],
    ]

    col_widths = [38 * mm, 28 * mm, 28 * mm, 28 * mm, 28 * mm]
    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 1), (-1, -1), 8.5),
        ('FONTNAME', (0, -2), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -2), (-1, -1), HexColor('#ecfdf5')),
        ('TEXTCOLOR', (1, -2), (-1, -1), GREEN),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, MID_GREY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -3), [WHITE, SLATE_50]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))

    tw, th = t.wrap(0, 0)
    t.drawOn(c, MARGIN + 5 * mm, y - th - 2 * mm)
    y -= th + 10 * mm

    # Callout
    c.setFillColor(HexColor('#fef3c7'))
    c.roundRect(MARGIN, y - 18 * mm, W - 2 * MARGIN, 18 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(DARK_TEXT)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGIN + 5 * mm, y - 7 * mm, "By Month 12, your pipeline could support 3-4 team members")
    c.setFont("Helvetica", 8.5)
    c.drawString(MARGIN + 5 * mm, y - 14 * mm,
                 "without you picking up a single tool. The work compounds. Your income compounds with it.")

    # Footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 8 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app  |  Page 3")


# ============================================================
# PAGE 4 - THE DEAL & GROWTH PATH
# ============================================================
def page_deal(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Header strip
    c.setFillColor(NAVY)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    if os.path.exists(logo_path):
        c.drawImage(logo_path, 12 * mm, H - 15.5 * mm, 13 * mm, 13 * mm,
                     preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(28 * mm, H - 13 * mm, "The Deal")
    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 12 * mm, H - 13 * mm, "Simple. Transparent. No Hidden Costs.")

    y = H - 32 * mm

    style_body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=14,
                                 textColor=DARK_TEXT)

    # Revenue split visual
    y = draw_header_bar(c, y, "Revenue Split")
    y += 2 * mm

    # Two columns - You Get / We Handle
    col_w = (W - 2 * MARGIN - 8 * mm) / 2

    # Left column - Partner
    c.setFillColor(HexColor('#ecfdf5'))
    c.roundRect(MARGIN, y - 70 * mm, col_w, 70 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(GREEN)
    c.setFont("Helvetica-Bold", 32)
    c.drawCentredString(MARGIN + col_w / 2, y - 18 * mm, "70%")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(MARGIN + col_w / 2, y - 26 * mm, "You Keep")

    c.setFillColor(DARK_TEXT)
    c.setFont("Helvetica", 8.5)
    partner_items = [
        "Your labour and team costs",
        "Materials (charged to customer separately)",
        "Your transport",
        "Your growth, your profit",
    ]
    item_y = y - 36 * mm
    for item in partner_items:
        c.setFillColor(GREEN)
        c.drawString(MARGIN + 8 * mm, item_y, "\u2713")
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica", 8.5)
        c.drawString(MARGIN + 15 * mm, item_y, item)
        item_y -= 6 * mm

    # Right column - Handy Services
    right_x = MARGIN + col_w + 8 * mm
    c.setFillColor(HexColor('#fef3c7'))
    c.roundRect(right_x, y - 70 * mm, col_w, 70 * mm, 3 * mm, fill=1, stroke=0)

    c.setFillColor(HexColor('#d97706'))
    c.setFont("Helvetica-Bold", 32)
    c.drawCentredString(right_x + col_w / 2, y - 18 * mm, "30%")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(right_x + col_w / 2, y - 26 * mm, "We Keep")

    c.setFillColor(DARK_TEXT)
    hs_items = [
        "Lead generation and marketing",
        "AI quoting and pricing engine",
        "Customer service and complaints",
        "Technology platform and app",
        "Brand and reputation",
        "Payment collection",
    ]
    item_y = y - 36 * mm
    for item in hs_items:
        c.setFillColor(HexColor('#d97706'))
        c.drawString(right_x + 8 * mm, item_y, "\u2713")
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica", 8.5)
        c.drawString(right_x + 15 * mm, item_y, item)
        item_y -= 6 * mm

    y -= 78 * mm

    # What you DON'T pay
    c.setFillColor(NAVY)
    c.roundRect(MARGIN, y - 22 * mm, W - 2 * MARGIN, 22 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 6 * mm, y - 8 * mm, "No franchise fee. No license fee. No upfront investment.")
    c.setFillColor(HexColor('#cbd5e1'))
    c.setFont("Helvetica", 8.5)
    c.drawString(MARGIN + 6 * mm, y - 16 * mm,
                 "We invest in the leads, technology, and brand. You invest your skills and commitment.")

    y -= 32 * mm

    # Growth path
    y = draw_header_bar(c, y, "Your Growth Path")
    y += 2 * mm

    phases = [
        {
            "phase": "PHASE 1",
            "title": "Prove It",
            "period": "Month 1-3",
            "color": GREEN,
            "points": [
                "You on the tools, supported by your team",
                "We send 10-15 jobs/week to your zone",
                "Learn the system, build the rhythm",
                "Earn ~\u00a33,000-3,500/month",
            ]
        },
        {
            "phase": "PHASE 2",
            "title": "Build The Team",
            "period": "Month 3-6",
            "color": GOLD,
            "points": [
                "Start putting your team on simpler jobs",
                "You take multi-skill and high-value work",
                "Volume grows to 15-20 jobs/week",
                "Recruit additional help as demand requires",
            ]
        },
        {
            "phase": "PHASE 3",
            "title": "Come Off The Tools",
            "period": "Month 6-12",
            "color": HexColor('#3b82f6'),
            "points": [
                "Your team handles 20-25 jobs/week",
                "You manage quality, diagnostics, team",
                "Only pick up tools for premium jobs",
                "Earn more while working less",
            ]
        },
        {
            "phase": "PHASE 4",
            "title": "Scale",
            "period": "Month 12+",
            "color": HexColor('#8b5cf6'),
            "points": [
                "Take on a second zone",
                "Recruit another lead tradesperson",
                "Run a proper operation across multiple areas",
                "Build the business you've always wanted",
            ]
        },
    ]

    phase_w = (W - 2 * MARGIN - 6 * mm) / 2
    phase_h = 45 * mm

    for i, ph in enumerate(phases):
        col = i % 2
        row = i // 2
        px = MARGIN + col * (phase_w + 6 * mm)
        py = y - row * (phase_h + 5 * mm)

        # Box
        c.setFillColor(SLATE_50)
        c.roundRect(px, py - phase_h, phase_w, phase_h, 3 * mm, fill=1, stroke=0)

        # Top accent
        c.setFillColor(ph["color"])
        c.roundRect(px, py - 2, phase_w, 3 * mm, 1.5 * mm, fill=1, stroke=0)

        # Phase label
        c.setFillColor(ph["color"])
        c.setFont("Helvetica-Bold", 7)
        c.drawString(px + 5 * mm, py - 10 * mm, ph["phase"])

        # Title + period
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(px + 5 * mm, py - 17 * mm, ph["title"])
        c.setFillColor(MID_GREY)
        c.setFont("Helvetica", 7.5)
        c.drawRightString(px + phase_w - 5 * mm, py - 17 * mm, ph["period"])

        # Points
        point_y = py - 24 * mm
        for point in ph["points"]:
            c.setFillColor(MID_GREY)
            c.setFont("Helvetica", 6)
            c.drawString(px + 5 * mm, point_y, "\u2022")
            c.setFillColor(DARK_TEXT)
            c.setFont("Helvetica", 7.5)
            c.drawString(px + 9 * mm, point_y, point)
            point_y -= 5 * mm

    # Footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 8 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app  |  Page 4")


# ============================================================
# PAGE 5 - EARNINGS PROJECTION
# ============================================================
def page_earnings(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Header strip
    c.setFillColor(NAVY)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    if os.path.exists(logo_path):
        c.drawImage(logo_path, 12 * mm, H - 15.5 * mm, 13 * mm, 13 * mm,
                     preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(28 * mm, H - 13 * mm, "Earnings Projection")
    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 12 * mm, H - 13 * mm, "Illustrative Figures")

    y = H - 35 * mm

    style_body = ParagraphStyle('body', fontName='Helvetica', fontSize=9, leading=13,
                                 textColor=DARK_TEXT)

    # Solo earnings
    y = draw_header_bar(c, y, "Phase 1: You On The Tools (Month 1-3)")
    y += 2 * mm

    solo_data = [
        ["", "Per Job (avg)", "Per Day (3 jobs)", "Per Week (4 days)", "Per Month"],
        ["Customer Pays", "\u00a3180", "\u00a3540", "\u00a32,160", "\u00a38,640"],
        ["Your 70%", "\u00a3126", "\u00a3378", "\u00a31,512", "\u00a36,048"],
    ]

    col_widths_solo = [32 * mm, 30 * mm, 35 * mm, 35 * mm, 30 * mm]
    t = Table(solo_data, colWidths=col_widths_solo)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), HexColor('#ecfdf5')),
        ('TEXTCOLOR', (1, -1), (-1, -1), GREEN),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, MID_GREY),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    tw, th = t.wrap(0, 0)
    t.drawOn(c, MARGIN, y - th)
    y -= th + 5 * mm

    note = """Note: These are illustrative figures based on an average job value of \u00a3180.
    Actual earnings depend on job mix, volume, and your zone's demand. Materials are charged
    to the customer separately and are not included in the revenue split."""
    p = Paragraph(note, ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=7.5,
                                        leading=10, textColor=MID_GREY))
    pw, ph = p.wrap(W - 2 * MARGIN, 20 * mm)
    p.drawOn(c, MARGIN, y - ph)
    y -= ph + 10 * mm

    # Team earnings
    y = draw_header_bar(c, y, "Phase 3: Your Team Working For You (Month 6-12)")
    y += 2 * mm

    team_data = [
        ["", "Jobs/Day", "Revenue/Week", "Your 70%", "Team Cost/Week", "Your Profit"],
        ["Tradesman A", "4", "\u00a32,880", "\u00a32,016", "\u00a3800", ""],
        ["Tradesman B", "3", "\u00a31,800", "\u00a31,260", "\u00a3700", ""],
        ["Labourer", "3", "\u00a31,200", "\u00a3840", "\u00a3600", ""],
        ["TOTAL", "10", "\u00a35,880", "\u00a34,116", "\u00a32,100", "\u00a32,016"],
    ]

    col_widths_team = [28 * mm, 20 * mm, 30 * mm, 25 * mm, 30 * mm, 28 * mm]
    t2 = Table(team_data, colWidths=col_widths_team)
    t2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), HexColor('#ecfdf5')),
        ('TEXTCOLOR', (-1, -1), (-1, -1), GREEN),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, MID_GREY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [WHITE, SLATE_50]),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    tw, th = t2.wrap(0, 0)
    t2.drawOn(c, MARGIN, y - th)
    y -= th + 5 * mm

    # Highlight box
    c.setFillColor(HexColor('#fef3c7'))
    c.roundRect(MARGIN, y - 22 * mm, W - 2 * MARGIN, 22 * mm, 3 * mm, fill=1, stroke=0)
    c.setFillColor(DARK_TEXT)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, y - 8 * mm, "\u00a32,016/week profit = ~\u00a38,000/month")
    c.setFont("Helvetica", 9)
    c.drawCentredString(W / 2, y - 17 * mm, "Without picking up a single tool. Your team does the work.")
    y -= 32 * mm

    # Comparison
    y = draw_header_bar(c, y, "Compare: Solo vs. With Handy Services")
    y += 2 * mm

    comp_data = [
        ["", "Working Solo", "With Handy Services (Phase 3)"],
        ["Find customers", "You (time + cost)", "We do it"],
        ["Quote jobs", "You (risk of underquoting)", "AI engine (accurate, instant)"],
        ["Handle complaints", "You", "We do it"],
        ["Chase payments", "You", "We collect + pay you in 48hrs"],
        ["On the tools daily?", "Yes - always", "Your choice"],
        ["Income ceiling", "Your hours", "Your team's hours"],
        ["Holiday = income?", "No work = no pay", "Team keeps earning for you"],
    ]

    col_widths_comp = [35 * mm, 55 * mm, 65 * mm]
    t3 = Table(comp_data, colWidths=col_widths_comp)
    t3.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (2, 1), (2, -1), HexColor('#ecfdf5')),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, MID_GREY),
        ('ROWBACKGROUNDS', (0, 1), (1, -1), [WHITE, SLATE_50]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    tw, th = t3.wrap(0, 0)
    t3.drawOn(c, MARGIN, y - th)

    # Footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 8 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app  |  Page 5")


# ============================================================
# PAGE 6 - NEXT STEPS
# ============================================================
def page_next_steps(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # Header strip
    c.setFillColor(NAVY)
    c.rect(0, H - 18 * mm, W, 18 * mm, fill=1, stroke=0)
    if os.path.exists(logo_path):
        c.drawImage(logo_path, 12 * mm, H - 15.5 * mm, 13 * mm, 13 * mm,
                     preserveAspectRatio=True, mask='auto')
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(28 * mm, H - 13 * mm, "Next Steps")
    c.setFillColor(GOLD)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 12 * mm, H - 13 * mm, "How We Get Started")

    y = H - 38 * mm

    style_body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.5, leading=14,
                                 textColor=DARK_TEXT)

    intro = """We believe in proving the model before making big commitments.
    That's why we're proposing a simple 30-day trial with no financial risk to you."""
    p = Paragraph(intro, style_body)
    pw, ph = p.wrap(W - 2 * MARGIN, 30 * mm)
    p.drawOn(c, MARGIN, y - ph)
    y -= ph + 10 * mm

    # Steps
    steps = [
        {
            "num": "1",
            "title": "Have A Chat",
            "desc": "No commitment. We'll walk you through the model, answer your questions, "
                     "and show you the technology. If it doesn't feel right, no hard feelings.",
        },
        {
            "num": "2",
            "title": "30-Day Trial",
            "desc": "We start sending you work in your zone. You do the jobs, we handle everything "
                     "else. We both measure the results - jobs completed, earnings, customer feedback. "
                     "Simple 70/30 split, paid within 48 hours.",
        },
        {
            "num": "3",
            "title": "Review The Numbers",
            "desc": "After 30 days we sit down together. Did the volume meet expectations? Are the "
                     "earnings right? Is the system working? We adjust whatever needs adjusting.",
        },
        {
            "num": "4",
            "title": "Make It Permanent",
            "desc": "If it works for both of us, we formalise the partnership. You get an exclusive "
                     "zone, priority access to all three work channels, and we start planning your "
                     "team growth together.",
        },
    ]

    for step in steps:
        # Step box
        box_h = 28 * mm
        c.setFillColor(SLATE_50)
        c.roundRect(MARGIN, y - box_h, W - 2 * MARGIN, box_h, 3 * mm, fill=1, stroke=0)

        # Number circle
        c.setFillColor(GOLD)
        c.circle(MARGIN + 12 * mm, y - box_h / 2, 8 * mm, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(MARGIN + 12 * mm, y - box_h / 2 - 2 * mm, step["num"])

        # Title
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(MARGIN + 25 * mm, y - 8 * mm, step["title"])

        # Description
        desc_style = ParagraphStyle('step_desc', fontName='Helvetica', fontSize=8.5,
                                     leading=11.5, textColor=SLATE_700)
        p = Paragraph(step["desc"], desc_style)
        pw, ph = p.wrap(W - 2 * MARGIN - 30 * mm, 20 * mm)
        p.drawOn(c, MARGIN + 25 * mm, y - 10 * mm - ph)

        y -= box_h + 5 * mm

    y -= 8 * mm

    # The promise box
    c.setFillColor(NAVY)
    c.roundRect(MARGIN, y - 50 * mm, W - 2 * MARGIN, 50 * mm, 4 * mm, fill=1, stroke=0)

    c.setFillColor(GOLD)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(W / 2, y - 12 * mm, "Our Promise")

    c.setFillColor(WHITE)
    c.setFont("Helvetica", 10)

    promises = [
        "We'll never send you a job without a clear, fixed price agreed with the customer.",
        "We'll pay you within 48 hours of every completed job.",
        "We'll handle all customer service, complaints, and admin.",
        "We'll grow the pipeline so you can grow your team.",
    ]

    py = y - 22 * mm
    for promise in promises:
        c.setFillColor(GOLD)
        c.setFont("Helvetica", 10)
        c.drawString(MARGIN + 12 * mm, py, "\u2713")
        c.setFillColor(WHITE)
        c.setFont("Helvetica", 9.5)
        c.drawString(MARGIN + 20 * mm, py, promise)
        py -= 7 * mm

    y -= 60 * mm

    # Contact
    c.setFillColor(DARK_TEXT)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(W / 2, y - 5 * mm, "Interested? Let's have a chat.")
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 10)
    c.drawCentredString(W / 2, y - 14 * mm, "07449 501 762  |  hello@handyservices.app")
    c.setFont("Helvetica", 9)
    c.drawCentredString(W / 2, y - 23 * mm, "www.handyservices.app")

    # Footer
    c.setFillColor(GOLD)
    c.rect(0, 0, W, 5 * mm, fill=1, stroke=0)
    c.setFillColor(MID_GREY)
    c.setFont("Helvetica", 7)
    c.drawCentredString(W / 2, 8 * mm, "CONFIDENTIAL  |  Handy Services  |  www.handyservices.app  |  Page 6")


# ============================================================
# BUILD PDF
# ============================================================
def build():
    output_path = os.path.join(os.path.dirname(__file__), "Handy_Services_Partner_Opportunity.pdf")
    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle("Handy Services - Partner Opportunity")
    c.setAuthor("Handy Services")
    c.setSubject("Partner Opportunity Proposal")

    page_cover(c)
    c.showPage()

    page_opportunity(c)
    c.showPage()

    page_revenue(c)
    c.showPage()

    page_deal(c)
    c.showPage()

    page_earnings(c)
    c.showPage()

    page_next_steps(c)
    c.showPage()

    c.save()
    print(f"PDF created: {output_path}")
    return output_path


if __name__ == "__main__":
    build()
