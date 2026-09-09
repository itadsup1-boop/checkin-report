# Web Admin source structure

```text
src/
├── app/                    # Application shell, routes and shell tests
├── assets/                 # Static assets imported by React
├── features/               # Business screens grouped by domain
│   ├── admin/
│   ├── attendance/
│   ├── auth/
│   ├── dashboard/
│   ├── leave/
│   ├── schedule/
│   ├── settings/
│   ├── staff/
│   └── warehouse/
├── styles/                 # Global styles
└── main.jsx                # React entry point only
```

## Conventions

- Keep routing, session bootstrap and the shared layout in `app/`.
- Put each business screen and its tests in the matching `features/<domain>/` folder.
- A feature may call the API but must not import another feature's internal files. Cross-feature navigation goes through `App.jsx`.
- Put reusable UI primitives in `components/` only after at least two features use them; avoid creating empty abstraction folders.
- Keep global CSS in `styles/` and feature-specific classes with the owning component.
