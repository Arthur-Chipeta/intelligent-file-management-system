# intelligent-file-management-system
AI-powered academic document classification and intelligent file organization system using NLP and machine learning.

## Sprint 2 authentication

The API supports account registration, login with a short-lived JWT, and authenticated
current-user lookup.

Required environment variables are documented in `.env.example`. Set a unique,
high-entropy `JWT_SECRET_KEY` outside development.

```text
POST /auth/register
POST /auth/login
GET  /auth/me       Authorization: Bearer <access_token>
```

Run the authentication tests from the project root:

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m pytest backend/tests
```

## Sprint 3 authentication integration

The browser frontend now provides registration, sign-in, session restoration, and
sign-out. File and webpage uploads require the JWT returned by `/auth/login`; the
frontend adds it to authenticated requests automatically.

## Sprint 4 persistent resource library

Uploaded files and webpage links are stored as user-owned PostgreSQL resources.
Generated storage names prevent filename collisions, and file retrieval and deletion
are authorized against the resource owner. The frontend loads the real library from
the API and includes an authenticated in-app PDF viewer.

```text
POST   /resources
POST   /resources/webpage
GET    /resources
GET    /resources/{id}
GET    /resources/{id}/file
DELETE /resources/{id}
```

Uploads default to the project `uploads` directory and a 20 MB limit. Both can be
configured with `UPLOAD_ROOT` and `MAX_UPLOAD_BYTES`.

## Sprint 5 topic labels

PDFs are analysed page-by-page and PowerPoint decks slide-by-slide. A hybrid,
explainable extractor attaches controlled computer-science topics and detected
headings with confidence scores and page or slide references. Labels are persisted,
returned with resources, displayed in the library and PDF viewer, and can be added
or removed by the resource owner.

```text
POST   /resources/{id}/topics
DELETE /resources/{id}/topics/{topic_id}
```

Install the backend dependencies, including PowerPoint extraction support, with:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

## Hybrid Computer Science categorization

Resources are categorized against a broad undergraduate Computer Science taxonomy.
The explainable classifier combines course codes, filenames, page or slide headings,
technical-term frequency, and local TF-IDF cosine similarity. Responses include a
confidence score, review flag, and the three strongest category candidates.

Users can click a resource category to inspect the evidence, rerun classification,
or save a manual correction. Manual corrections are retained during automatic
reclassification and provide labelled examples for future model evaluation.

```text
GET   /categories
PATCH /resources/{id}/category
POST  /resources/{id}/reclassify
```

## Hierarchical My Library folders

My Library is a functional folder browser. Automatically classified resources are
organized as `Course → Material type → File`; lecture-named PDFs and PowerPoint
decks are placed under `Lecture Slides`, with other resources grouped into Course
Materials, Web Resources, Images, or Videos. Existing resources are backfilled.

Folders are user-owned, nested, createable, and renameable. A stable system key
means renaming an automatic course folder does not cause the original name to be
recreated on the next upload. Manual file moves are preserved.

```text
GET   /folders/contents?parent_id={id}
POST  /folders
PATCH /folders/{id}
PATCH /folders/resources/{resource_id}/move
```
