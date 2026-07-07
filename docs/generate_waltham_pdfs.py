x!/usr/bin/env python3
"""Generate two PDFs for Waltham House meeting — Handy Services branding."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable
)
import os

LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "..", "client", "public", "logo.png")

# ─── Handy Services Brand Colours (from website) ───
DARK_BG = HexColor("#111827")
NAVY = HexColor("#1a2035")
GOLD = HexColor("#f5a623")
GOLD_DARK = HexColor("#d4891a")
GOLD_LIGHT = HexColor("#fef9f0")
GREEN_ACCENT = HexColor("#22c55e")
GREEN = HexColor("#16a34a")
LIGHT_GREEN = HexColor("#f0fdf4")
RED = HexColor("#dc2626")
LIGHT_RED = HexColor("#fef2f2")
GREY = HexColor("#6b7280")
LIGHT_GREY = HexColor("#f3f4f6")
DARK = HexColor("#111827")
MID_GREY = HexColor("#374151")
WHITE = white

PHONE = "07449 501 762"
BRAND = "Handy Services"
REVIEW_LINE = "4.9 from 300+ Reviews on Google"
W, H = A4

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))


# ─────────────────────────────────────────────
# Styles
# ─────────────────────────────────────────────

def base_styles():
    return {
        "title": ParagraphStyle(
            "title", fontName="Helvetica-Bold", fontSize=22,
            textColor=NAVY, spaceAfter=2*mm, leading=26
        ),
        "subtitle": ParagraphStyle(
            "subtitle", fontName="Helvetica", fontSize=12,
            textColor=GREY, spaceAfter=6*mm, leading=16
        ),
        "section": ParagraphStyle(
            "section", fontName="Helvetica-Bold", fontSize=13,
            textColor=NAVY, spaceBefore=5*mm, spaceAfter=3*mm, leading=16
        ),
        "body": ParagraphStyle(
            "body", fontName="Helvetica", fontSize=10,
            textColor=DARK, spaceAfter=2*mm, leading=14
        ),
        "bullet": ParagraphStyle(
            "bullet", fontName="Helvetica", fontSize=10,
            textColor=DARK, leftIndent=12*mm, bulletIndent=6*mm,
            spaceAfter=1.5*mm, leading=14
        ),
        "quote_text": ParagraphStyle(
            "quote_text", fontName="Helvetica-Oblique", fontSize=10,
            textColor=MID_GREY, leftIndent=14*mm, bulletIndent=6*mm,
            spaceAfter=1.5*mm, leading=14
        ),
    }


def branded_header_canvas(canvas_obj, doc, show_review=False):
    """Draw the dark navy header bar with logo and gold accent on every page."""
    canvas_obj.saveState()
    # Dark header bar
    canvas_obj.setFillColor(NAVY)
    canvas_obj.rect(0, H - 28*mm, W, 28*mm, fill=1, stroke=0)
    # Gold accent strip
    canvas_obj.setFillColor(GOLD)
    canvas_obj.rect(0, H - 29.5*mm, W, 1.5*mm, fill=1, stroke=0)
    # Logo
    logo_size = 18*mm
    logo_x = 18*mm
    logo_y = H - 24*mm
    if os.path.exists(LOGO_PATH):
        canvas_obj.drawImage(
            LOGO_PATH, logo_x, logo_y, logo_size, logo_size,
            mask='auto', preserveAspectRatio=True
        )
    # Brand name
    canvas_obj.setFillColor(WHITE)
    canvas_obj.setFont("Helvetica-Bold", 16)
    canvas_obj.drawString(logo_x + logo_size + 3*mm, H - 16*mm, BRAND)
    # Phone
    canvas_obj.setFont("Helvetica-Bold", 11)
    canvas_obj.setFillColor(GOLD)
    canvas_obj.drawRightString(W - 20*mm, H - 12*mm, PHONE)
    if show_review:
        canvas_obj.setFont("Helvetica", 8.5)
        canvas_obj.setFillColor(HexColor("#d1d5db"))
        canvas_obj.drawRightString(W - 20*mm, H - 20*mm, REVIEW_LINE)
    # Footer bar
    canvas_obj.setFillColor(NAVY)
    canvas_obj.rect(0, 0, W, 14*mm, fill=1, stroke=0)
    canvas_obj.setFillColor(GOLD)
    canvas_obj.rect(0, 14*mm, W, 1*mm, fill=1, stroke=0)
    canvas_obj.setFillColor(HexColor("#d1d5db"))
    canvas_obj.setFont("Helvetica", 7.5)
    canvas_obj.drawCentredString(
        W / 2, 5*mm,
        f"{BRAND}  |  Fully Insured  |  \u00a32M Public Liability  |  DBS Checked  |  {PHONE}"
    )
    canvas_obj.restoreState()


def header_brief(canvas_obj, doc):
    branded_header_canvas(canvas_obj, doc, show_review=False)

def header_rate_card(canvas_obj, doc):
    branded_header_canvas(canvas_obj, doc, show_review=True)


def info_box(story, bg_color, border_color, content_paragraphs):
    t = Table([[content_paragraphs]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg_color),
        ("BOX", (0, 0), (-1, -1), 1.2, border_color),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(t)
    story.append(Spacer(1, 3*mm))


def gold_section_heading(story, text):
    content = Paragraph(f"<b>{text}</b>", ParagraphStyle(
        "sec_h", fontName="Helvetica-Bold", fontSize=13,
        textColor=NAVY, leading=16
    ))
    t = Table([[content]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBEFORE", (0, 0), (0, -1), 3, GOLD),
    ]))
    story.append(Spacer(1, 4*mm))
    story.append(t)
    story.append(Spacer(1, 2*mm))


# ═════════════════════════════════════════════
# PDF 1: Emile's Meeting Brief
# ═════════════════════════════════════════════

def create_emile_brief():
    path = os.path.join(OUTPUT_DIR, "Emile_Meeting_Brief_Waltham_House.pdf")
    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=32*mm, bottomMargin=20*mm
    )
    s = base_styles()
    story = []

    # Title block
    story.append(Paragraph("Meeting Brief \u2014 Waltham House", s["title"]))
    story.append(Paragraph(
        "INTERNAL ONLY \u2014 Do not share with the client",
        ParagraphStyle("int_warn", fontName="Helvetica-Bold", fontSize=10,
                       textColor=RED, spaceAfter=5*mm)
    ))

    # Meeting details box
    info_box(story, GOLD_LIGHT, GOLD, [
        Paragraph("<b>Meeting Details</b>", ParagraphStyle(
            "box_title", fontName="Helvetica-Bold", fontSize=11,
            textColor=NAVY, spaceAfter=2*mm
        )),
        Paragraph("<b>Contact:</b>  Andrea (Manager)", s["body"]),
        Paragraph("<b>Location:</b>  Waltham House, Wirksworth", s["body"]),
        Paragraph("<b>Type:</b>  Extra care scheme for elderly residents", s["body"]),
        Paragraph("<b>Date:</b>  Today", s["body"]),
    ])

    # Your role
    gold_section_heading(story, "Your Role Today")
    info_box(story, LIGHT_GREEN, GREEN, [
        Paragraph(
            "You are here to <b>listen</b>, <b>learn about their needs</b>, "
            "<b>take photos/videos</b> of the property, and <b>leave a great impression</b>.",
            ParagraphStyle("role", fontName="Helvetica", fontSize=10.5,
                           textColor=DARK, leading=15, spaceAfter=2*mm)
        ),
        Paragraph(
            "You are <b>NOT</b> quoting on the spot. Hand over the rate card and say "
            "our team will follow up with a tailored proposal.",
            ParagraphStyle("role2", fontName="Helvetica", fontSize=10.5,
                           textColor=DARK, leading=15)
        ),
    ])

    # Talking points
    gold_section_heading(story, "Key Talking Points")
    for tp in [
        "\u201cWe provide a full property maintenance service \u2014 general repairs, electrical, plumbing, and more.\u201d",
        "\u201cWe\u2019re fully insured \u2014 \u00a32M public liability.\u201d",
        "\u201cWe can offer scheduled maintenance days \u2014 typically 2 days a month.\u201d",
        "\u201cI\u2019ve brought our rate card for you to review.\u201d",
        "\u201cOur team will follow up with a tailored proposal after today.\u201d",
    ]:
        story.append(Paragraph(tp, s["quote_text"], bulletText="\u2022"))

    story.append(Spacer(1, 1*mm))

    # What to photograph
    gold_section_heading(story, "What to Photograph / Video")
    story.append(Paragraph(
        "<i>Always ask permission before photographing.</i>", s["body"]
    ))
    for item in [
        "Common areas and corridors",
        "Any visible maintenance issues or damage",
        "Fire doors (condition, closers, seals)",
        "Bathrooms and kitchens",
        "External areas and car park",
        "Signage, entry points, accessibility features",
    ]:
        story.append(Paragraph(item, s["bullet"], bulletText="\u2022"))

    story.append(Spacer(1, 1*mm))

    # Questions to ask
    gold_section_heading(story, "Questions to Ask Andrea")
    for q in [
        "How many units / rooms are there at Waltham House?",
        "What types of repairs come up most often?",
        "Is there a current backlog of maintenance jobs?",
        "Who raises repair requests \u2014 staff, residents, or families?",
        "Do you need compliance paperwork (electrical certs, etc.)?",
        "Who is your current maintenance provider? What\u2019s not working?",
        "Are there any urgent jobs you need done right now?",
    ]:
        story.append(Paragraph(q, s["bullet"], bulletText="\u2022"))

    story.append(Spacer(1, 2*mm))

    # DO NOT section
    gold_section_heading(story, "Important \u2014 Do NOT")
    info_box(story, LIGHT_RED, RED, [
        Paragraph("\u2718  Do NOT quote prices verbally \u2014 hand over the rate card and say "
                  "\u201cour team will follow up with a tailored proposal.\u201d",
                  ParagraphStyle("r1", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=RED, spaceAfter=2*mm, leading=14)),
        Paragraph("\u2718  Do NOT commit to start dates or specific availability.",
                  ParagraphStyle("r2", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=RED, spaceAfter=2*mm, leading=14)),
        Paragraph("\u2718  Do NOT claim any personal trade qualifications.",
                  ParagraphStyle("r3", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=RED, spaceAfter=2*mm, leading=14)),
        Paragraph("\u2718  Do NOT promise specific tradespeople.",
                  ParagraphStyle("r4", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=RED, spaceAfter=2*mm, leading=14)),
        Paragraph("\u2718  If asked technical questions, say: \u201cLet me get our specialist "
                  "team to come back to you on that.\u201d",
                  ParagraphStyle("r5", fontName="Helvetica-Bold", fontSize=10,
                                 textColor=RED, leading=14)),
    ])

    # What to leave behind
    gold_section_heading(story, "What to Leave Behind")
    story.append(Paragraph(
        "Hand Andrea the <b>Handy Services Rate Card</b> (the other document). "
        "Let her know our team will be in touch with a full proposal.",
        s["body"]
    ))

    doc.build(story, onFirstPage=header_brief, onLaterPages=header_brief)
    print(f"Created: {path}")


# ═════════════════════════════════════════════
# PDF 2: Client Rate Card
# ═════════════════════════════════════════════

def create_rate_card():
    path = os.path.join(OUTPUT_DIR, "V6_Rate_Card_Waltham_House.pdf")
    doc = SimpleDocTemplate(
        path, pagesize=A4,
        leftMargin=20*mm, rightMargin=20*mm,
        topMargin=32*mm, bottomMargin=20*mm
    )
    s = base_styles()
    story = []

    # Title
    story.append(Paragraph("Property Maintenance Rate Card", s["title"]))
    story.append(Paragraph(
        "Prepared for Waltham House, Wirksworth",
        ParagraphStyle("sub", fontName="Helvetica", fontSize=12,
                       textColor=GREY, spaceAfter=5*mm)
    ))

    # Trust strip
    trust_style = ParagraphStyle("trust", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=NAVY, alignment=TA_CENTER, leading=12)
    trust_data = [[
        Paragraph("\u00a32M Insured", trust_style),
        Paragraph("4.9\u2605 Google (300+ reviews)", trust_style),
        Paragraph("DBS Checked", trust_style),
        Paragraph("Next-Day Slots", trust_style),
    ]]
    trust_table = Table(trust_data, colWidths=[42*mm, 52*mm, 35*mm, 36*mm])
    trust_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GOLD_LIGHT),
        ("BOX", (0, 0), (-1, -1), 1, GOLD),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(trust_table)
    story.append(Spacer(1, 4*mm))

    # About
    gold_section_heading(story, f"About {BRAND}")
    story.append(Paragraph(
        f"{BRAND} is Nottingham\u2019s fastest growing property services team, "
        "serving residential and commercial properties across the East Midlands. "
        "We carry \u00a32M public liability insurance and DBS-checked operatives "
        "are available for sensitive environments.",
        s["body"]
    ))

    # Rate table — two payment columns
    gold_section_heading(story, "Our Rates")
    rate_data = [
        ["Service", "Pay on Completion", "Net 30 Terms", "Details"],
        ["Scheduled\nMaintenance Day",
         "\u00a3375 / day", "\u00a3394 / day",
         "8-hour day. Ideal for planned\nmaintenance programmes."],
        ["Ad-Hoc Hourly Rate",
         "\u00a345 / hour", "\u00a347 / hour",
         "Minimum 1 hour. For smaller\none-off repairs."],
        ["Emergency Callout",
         "\u00a385 callout\n+ \u00a345/hr", "\u00a389 callout\n+ \u00a347/hr",
         "Same-day / next-day response\nfor urgent repairs."],
        ["Materials",
         "Cost + 20%", "Cost + 20%",
         "Receipts provided for\nfull transparency."],
        ["Travel (Wirksworth)",
         "\u00a325 / visit", "\u00a325 / visit",
         "Flat surcharge for locations\noutside our Derby area."],
    ]
    rate_table = Table(rate_data, colWidths=[38*mm, 34*mm, 34*mm, 59*mm])
    rate_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 1), (2, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 9),
        ("TEXTCOLOR", (1, 1), (1, -1), NAVY),
        ("TEXTCOLOR", (2, 1), (2, -1), NAVY),
        ("BACKGROUND", (0, 1), (-1, 1), GOLD_LIGHT),
        ("BACKGROUND", (0, 2), (-1, 2), WHITE),
        ("BACKGROUND", (0, 3), (-1, 3), GOLD_LIGHT),
        ("BACKGROUND", (0, 4), (-1, 4), WHITE),
        ("BACKGROUND", (0, 5), (-1, 5), GOLD_LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (2, -1), "CENTER"),
    ]))
    story.append(rate_table)
    story.append(Spacer(1, 1*mm))
    story.append(Paragraph(
        "<i>Net 30 terms: 5% surcharge applied. Retainer clients receive Net 30 at no extra cost.</i>",
        ParagraphStyle("note", fontName="Helvetica-Oblique", fontSize=9,
                       textColor=GOLD_DARK, spaceAfter=3*mm)
    ))

    # Services
    gold_section_heading(story, "Services We Cover")
    svc_style = ParagraphStyle("svc", fontName="Helvetica", fontSize=9.5,
                                textColor=DARK, leading=13)
    left_col = [Paragraph(f"\u2022  {svc}", svc_style) for svc in [
        "General repairs & maintenance",
        "Electrical repairs (qualified electricians)",
        "Plumbing repairs (qualified plumbers)",
        "Carpentry & joinery",
        "Painting & decorating",
    ]]
    right_col = [Paragraph(f"\u2022  {svc}", svc_style) for svc in [
        "Door & window repairs",
        "Bathroom & kitchen maintenance",
        "External repairs & grounds",
        "Fire door maintenance",
        "Grab rails & accessibility modifications",
    ]]
    svc_table = Table([[left_col, right_col]], colWidths=[82*mm, 82*mm])
    svc_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(svc_table)
    story.append(Spacer(1, 2*mm))

    # What's included
    gold_section_heading(story, "What\u2019s Included")
    for item in [
        "<b>Photo report</b> after each visit",
        "<b>Dedicated account manager</b> \u2014 single point of contact",
        "<b>Priority scheduling</b> for your facility",
        "<b>Tax-ready monthly invoicing</b> for your accounts team",
    ]:
        story.append(Paragraph(item, s["bullet"], bulletText="\u2713"))
    story.append(Spacer(1, 2*mm))

    # Pricing comparison: Ad-hoc (Net 30) vs Retainer
    gold_section_heading(story, "Pricing Options")
    compare_data = [
        ["", "Ad-Hoc (Net 30)", "Retainer (Recommended)"],
        ["Commitment", "Pay as you go", "2+ days per month"],
        ["Day Rate", "\u00a3394 / day", "\u00a3356 / day"],
        ["Payment Terms", "Net 30 (+5%)", "Net 30 (included)"],
        ["Travel (2 visits)", "\u00a350 / month", "Included"],
        ["Monthly Cost\n(2 days + travel)", "\u00a3838 / month", "\u00a3712 / month"],
        ["Annual Cost", "\u00a310,056 / year", "\u00a38,544 / year"],
        ["You Save", "\u2014", "\u00a31,512 / year (15%)"],
        ["Priority Scheduling", "\u2014", "\u2713"],
        ["Dedicated Account Mgr", "\u2014", "\u2713"],
    ]
    compare_table = Table(compare_data, colWidths=[45*mm, 55*mm, 65*mm])
    compare_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), GOLD),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("BACKGROUND", (2, 1), (2, -1), GOLD_LIGHT),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 1), (-1, -1), 9.5),
        ("TEXTCOLOR", (2, 7), (2, 7), GREEN),
        ("FONTNAME", (2, 7), (2, 7), "Helvetica-Bold"),
        ("FONTNAME", (2, 8), (2, 9), "Helvetica-Bold"),
        ("TEXTCOLOR", (2, 8), (2, 9), GREEN),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
    ]))
    story.append(compare_table)
    story.append(Spacer(1, 3*mm))

    # Recommended package box
    info_box(story, GOLD_LIGHT, GOLD, [
        Paragraph("<b>Recommended: Facility Maintenance Retainer</b>", ParagraphStyle(
            "pkg_t", fontName="Helvetica-Bold", fontSize=12,
            textColor=NAVY, spaceAfter=2*mm
        )),
        Paragraph(
            "2 scheduled days per month at \u00a3356/day = <b>\u00a3712/month</b>",
            ParagraphStyle("pkg_p", fontName="Helvetica-Bold", fontSize=14,
                           textColor=NAVY, spaceAfter=2*mm, leading=18)
        ),
        Paragraph(
            "Save \u00a31,512/year vs ad-hoc Net 30 rates. Travel and Net 30 terms included. "
            "Plus photo reports, priority emergency callouts, and a dedicated point of contact.",
            ParagraphStyle("pkg_d", fontName="Helvetica", fontSize=10,
                           textColor=DARK, leading=14)
        ),
    ])

    # Next steps
    gold_section_heading(story, "Next Steps")
    story.append(Paragraph(
        "We\u2019ll follow up with a tailored proposal for Waltham House. "
        "In the meantime, if you have any questions, please don\u2019t hesitate to get in touch.",
        s["body"]
    ))
    story.append(Spacer(1, 3*mm))

    # Contact box
    contact_inner = [
        Paragraph("<b>Get in Touch</b>", ParagraphStyle(
            "ct", fontName="Helvetica-Bold", fontSize=11,
            textColor=GOLD, spaceAfter=2*mm
        )),
        Paragraph(
            f"Phone:  {PHONE}",
            ParagraphStyle("cp", fontName="Helvetica", fontSize=10,
                           textColor=WHITE, spaceAfter=1*mm, leading=14)
        ),
        Paragraph(
            "Email:  info@handyservices.co.uk",
            ParagraphStyle("ce", fontName="Helvetica", fontSize=10,
                           textColor=WHITE, leading=14)
        ),
    ]
    ct = Table([[contact_inner]], colWidths=[165*mm])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("BOX", (0, 0), (-1, -1), 1, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(ct)

    doc.build(story, onFirstPage=header_rate_card, onLaterPages=header_rate_card)
    print(f"Created: {path}")


# ─────────────────────────────────────────────
if __name__ == "__main__":
    create_emile_brief()
    create_rate_card()
    print("\nDone! Both PDFs created.")
