"""Populate the database with realistic sample data so the dashboard isn't empty.

Creates two demo accounts:
  - admin@momentum.app / admin123   (role: admin)
  - demo@momentum.app  / demo123    (role: user)
"""
import random
from datetime import date, timedelta, datetime

from app.database import SessionLocal, engine, Base
from app import models
from app.auth import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# Clear existing data for a clean seed.
#
# Order matters: children before parents, or SQLite's FK constraints reject the
# delete. Rather than hand-maintaining that list (which silently breaks every
# time a new table with a foreign key is added — e.g. job_hits.application_id
# pointing at job_applications), derive it from the metadata: sorted_tables is
# in dependency order, so reversing it gives children-before-parents.
#
# Reference data that isn't tied to a user is preserved — sponsor_orgs alone is
# ~125k rows scraped from the sponsor register and is expensive to rebuild.
PRESERVE = {"sponsor_orgs", "sponsor_register_meta", "company_boards"}

for table in reversed(Base.metadata.sorted_tables):
    if table.name in PRESERVE:
        # Keep the global rows, but drop any user-owned ones — otherwise they
        # would still point at users we're about to delete.
        if "user_id" in table.c:
            db.execute(table.delete().where(table.c.user_id.isnot(None)))
        continue
    db.execute(table.delete())
db.commit()

admin = models.User(name="Admin", email="admin@momentum.app",
                     password_hash=hash_password("admin123"), role=models.UserRole.admin)
demo = models.User(name="Demo User", email="demo@momentum.app",
                    password_hash=hash_password("demo123"), role=models.UserRole.user)
db.add_all([admin, demo])
db.commit()

USER = demo  # seed the rich sample data onto the demo (non-admin) account

HABIT_TITLES = [
    "Wake up at 6:30", "Drink 2L of water", "No gooning", "Gym",
    "Read 10 pages", "Budget tracking", "Studying", "Stretching",
    "Meditation", "No smoking",
]

today = date.today()
start = today - timedelta(days=today.weekday())  # Monday of this week
habit_start_date = start - timedelta(weeks=9)  # matches the 10-week history seeded below

habits = []
for title in HABIT_TITLES:
    h = models.Habit(user_id=USER.id, title=title, category="General",
                      created_at=datetime.combine(habit_start_date, datetime.min.time()))
    db.add(h)
    habits.append(h)
db.commit()

# Seed ~10 weeks of habit history so month/year views have meaningful data
for week_offset in range(-9, 1):
    week_start = start + timedelta(weeks=week_offset)
    for h in habits:
        for day_i in range(7):
            d = week_start + timedelta(days=day_i)
            if d > today:
                continue
            completed = random.random() < 0.75
            db.add(models.HabitEntry(habit_id=h.id, date=d, completed=completed,
                                      completed_at=datetime.utcnow() if completed else None))
db.commit()

SAMPLE_TASKS = {
    0: ["Write 10 content ideas", "Cancel subscriptions", "Buy vitamins", "Dentist appointment", "Cook a healthy meal"],
    1: ["Court case", "Meet up with friends", "Redesign website", "Analyze charts", "Client meeting"],
    2: ["Post at 8:00", "Check emails", "Grocery shopping", "Cook a healthy meal", "Plan workout routine"],
    3: ["Check sales metrics", "Reply to DMs", "Create ad creatives", "Meet up with friends", "Client meeting"],
    4: ["Doctor appointment", "Take creatine", "Reschedule meeting", "Write 10 content ideas", "Book flights"],
    5: ["Meditate", "Sauna + Gym", "Play basketball", "Client meeting", "Call grandparents"],
    6: ["Fix ad targeting", "Create landing page", "Work on digital product", "Grocery shopping", "Buy coffee beans"],
}
TASK_TAGS = {
    "Client meeting": "urgent", "Dentist appointment": "urgent", "Doctor appointment": "urgent",
    "Court case": "urgent", "Book flights": "quick-win", "Buy vitamins": "quick-win",
    "Cancel subscriptions": "quick-win", "Redesign website": "big-project",
}
for week_offset in range(-2, 1):
    week_start = start + timedelta(weeks=week_offset)
    for day_i, titles in SAMPLE_TASKS.items():
        d = week_start + timedelta(days=day_i)
        if d > today:
            continue
        for t in titles:
            completed = random.random() < 0.8
            db.add(models.Task(user_id=USER.id, date=d, title=t, completed=completed, tags=TASK_TAGS.get(t),
                                completed_at=datetime.utcnow() if completed else None))
db.commit()

db.add(models.WeeklyNote(
    user_id=USER.id, week_start_date=start,
    focus_text="No Gooning", reward_text="Cheat meal", affirmation_text="Why not you?",
))
db.commit()

# Study plan for today and tomorrow
STUDY_SUBJECTS = [("Linear Algebra", "06:30", "07:30"), ("System Design", "18:00", "19:30"),
                   ("DSA Practice", "20:00", "21:00")]
for day_offset in range(0, 3):
    d = today + timedelta(days=day_offset)
    for subject, s, e in STUDY_SUBJECTS:
        db.add(models.StudyBlock(user_id=USER.id, date=d, subject=subject, start_time=s, end_time=e,
                                  completed=(day_offset == 0 and random.random() < 0.6)))
db.commit()

import os
import json
from app.resume_pdf import build_resume_pdf, build_plain_text
from app.ats_scorer import score_resume_against_job

r1_text = ("Backend Engineer with 4 years experience in Python, FastAPI, PostgreSQL, and AWS. "
           "Built REST APIs, optimized database queries, and deployed services on AWS ECS and Lambda. "
           "Strong background in distributed systems, microservices, and CI/CD pipelines.")
r2_text = ("Full stack engineer skilled in React, TypeScript, Node.js, and GraphQL. "
           "Built responsive web applications, component libraries, and real-time features using WebSockets. "
           "Comfortable across the stack from Postgres schemas to pixel-perfect UI.")

r1 = models.Resume(user_id=USER.id, name="Backend_Resume_v3.pdf",
                    notes="Focus on Python/FastAPI roles", extracted_text=r1_text)
r2 = models.Resume(user_id=USER.id, name="Fullstack_Resume_v2.pdf",
                    notes="Focus on React + Node roles", extracted_text=r2_text)
db.add_all([r1, r2])
db.commit()

# A third resume generated straight through the Resume Builder, using the
# Classic Professional template, so the feature has a real example on first run.
builder_data = {
    "full_name": "Dheeraj Gudi", "title": "Data Analyst",
    "location": "Newcastle Upon Tyne, England", "phone": "+44 7733 658594",
    "email": "dheeraj.gudi1999@gmail.com", "linkedin": "linkedin.com/in/gudi-dheeraj",
    "website": "gudidheeraj.github.io/personalfwebpage",
    "summary": "- Data Analyst with over 4 years of experience in financial data analysis, enterprise reporting, and operations management across the public and private sectors.\n"
               "- Skilled in SQL, Python, and Power BI for dashboards, process automation, and large scale dataset analysis, with hands on experience using AWS Redshift and Amazon S3.",
    "skills": "Programming Languages: Python, SQL, PL/SQL, R, C, C++\n"
              "Data Analysis and Visualization: Power BI (DAX), Tableau, Advanced Microsoft Excel (Pivot Tables, Power Query, VBA, Macros), Matplotlib\n"
              "Cloud and Data Platforms: AWS (Redshift, S3, Glue), Google Cloud Platform, Microsoft Azure",
    "experience": "Operations Delivery Manager | Department for Work and Pensions, UK Civil Service | Newcastle, UK | Aug 2025 - Present\n"
                  "- Manage advanced Excel reporting and data visualization for the team, building dashboards that track casework volumes and quality.\n"
                  "- Lead a team of 12 to 15 specialist caseworkers handling complex cases from across Britain.\n"
                  "---\n"
                  "Data Analyst | Tata Consultancy Services | Bangalore, India | Jul 2021 - Oct 2023\n"
                  "- Analysed financial datasets using SQL and Python across client portfolios worth more than $400,000.\n"
                  "- Built Power BI dashboards with custom DAX measures to track revenue, risk exposure, and audit metrics across 8 business units.",
    "education": "MSc, Data Science (Merit) | Durham University, Durham, UK | Sep 2023 - Jan 2025\n"
                 "---\n"
                 "Master of Computer Applications (MCA), CGPA 8.78/10 | Manipal University (Online), Jaipur, India | Nov 2021 - Dec 2023",
    "projects": "Enterprise Knowledge Assistant (RAG/LLM): Built a retrieval augmented generation assistant using Python, LangChain, FAISS, and Azure OpenAI.\n"
                "---\n"
                "LLM Prompt Evaluation Framework: Built an automated framework in Python that scores LLM outputs on accuracy, relevance, and hallucination.",
    "publications": "Numerical Investigation on the Performance of Triple Pipe Heat Exchanger with Helical Fins and Twisted Tape Inserts, Springer, Nov 2021\n"
                    "Unsupervised Machine Learning Approach for Categorizing IPL Players Based on Performance Metrics, AIP, Aug 2024",
    "certifications": "Google Cloud Certified, Associate Cloud Engineer\nGoogle Cloud Certified, Professional Cloud Architect",
}
uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
generated_filename = "sample_generated_resume.pdf"
build_resume_pdf("classic_professional", builder_data, os.path.join(uploads_dir, generated_filename))
r3 = models.Resume(
    user_id=USER.id, name="Dheeraj Gudi - Classic Professional",
    filename=generated_filename, notes="Generated with the Resume Builder (Classic Professional template)",
    extracted_text=build_plain_text(builder_data), template_id="classic_professional",
    builder_data=json.dumps(builder_data),
)
db.add(r3)
db.commit()

SAMPLE_JOBS = [
    ("Stripe", "Backend Engineer", "applied", "Python, FastAPI, PostgreSQL, AWS", r1.id, "LinkedIn",
     "We're looking for a Backend Engineer to build and scale APIs powering payments infrastructure. "
     "Requirements: strong Python experience, FastAPI or similar async frameworks, PostgreSQL, AWS (ECS/Lambda), "
     "and a solid understanding of distributed systems and microservices architecture. CI/CD experience a plus.",
     "Dear Stripe team,\n\nI'm excited to apply for the Backend Engineer role. My 4 years building Python/FastAPI "
     "services on AWS, including REST APIs and microservices, line up closely with what you're looking for.\n\nBest,\nDemo User",
     "dream-job,high-priority"),
    ("Notion", "Full Stack Engineer", "phone_screen", "React, TypeScript, Node.js, GraphQL", r2.id, "Referral", None, None, "referral"),
    ("Datadog", "Software Engineer", "interview", "Python, Go, Kubernetes, Distributed Systems", r1.id, "Company site", None, None, "high-priority"),
    ("Figma", "Frontend Engineer", "rejected", "React, TypeScript, CSS, WebGL", r2.id, "LinkedIn", None, None, None),
    ("Airbnb", "Backend Engineer", "oa_test", "Python, Django, SQL, Microservices", r1.id, "LinkedIn", None, None, "backup"),
    ("Linear", "Product Engineer", "ghosted", "React, TypeScript, GraphQL", r2.id, "Company site", None, None, None),
    ("Anthropic", "Software Engineer", "applied", "Python, FastAPI, Distributed Systems, ML", r1.id, "Referral", None, None, "dream-job"),
]
for company, role, status, skills, resume_id, source, jd, cover_letter, tags in SAMPLE_JOBS:
    d_applied = today - timedelta(days=random.randint(1, 30))
    ats_score, ats_breakdown = None, None
    if jd:
        resume_for_score = r1 if resume_id == r1.id else r2
        result = score_resume_against_job(resume_for_score.extracted_text or "", jd)
        ats_score = result["score"]
        ats_breakdown = json.dumps(result)
    db.add(models.JobApplication(
        user_id=USER.id, company_name=company, role_title=role,
        job_link=f"https://{company.lower()}.com/careers",
        date_applied=d_applied, status=status, resume_id=resume_id,
        skills_required=skills, location="Remote", source=source, tags=tags,
        job_description=jd, cover_letter=cover_letter, ats_score=ats_score, ats_breakdown=ats_breakdown,
        next_action_date=today + timedelta(days=random.randint(0, 6)) if status in ("interview", "phone_screen") else None,
    ))
db.commit()
db.close()

print("Seed complete.")
print("  Admin login:  admin@momentum.app / admin123")
print("  Demo login:   demo@momentum.app / demo123  (has sample habits/tasks/jobs)")
