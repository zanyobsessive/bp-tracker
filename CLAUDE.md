# BP-Tracker Project

## What This Is

A fish survival contest tracker between:
- **VP (Zane)**: Owns "bp" (Basis Point, aka "Bippy") - a betta fish with magnificent long fins
- **The Lair** (junior employees at Bain Capital): Own "Proletariat" (aka "Prole") - a short-finned, less regal fish

The Lair previously killed "Dividend Recap" (Divvy) in 9 days (Sep 5-14, 2025). This is their second attempt.

**Contest rules**: First fish to die loses. If both survive to 2027, The Lair wins.

## Two Websites

### zanestiles.com
- Main bp tracker site
- S3 bucket: `zanestiles.com`
- CloudFront distribution: `E3BBASY76ZFTO7`
- Key pages: `/scoreboard.html`, `/feeding.html`, `/live.html`

### cooperlemone.com
- Taunting memorial site for dead Divvy (hosted on a domain Zane bought that's a Lair member's name)
- S3 bucket: `cooperlemone.com`
- CloudFront distribution: `E48TF22UWGVG9`
- Features photo of dead Divvy at bottom of tank

## AWS Setup

Region: `us-east-1`

You'll need AWS CLI configured. The user should run:
```bash
aws configure
```

Route 53 hosted zones:
- zanestiles.com: `Z12NLH2NWC7QRF`
- cooperlemone.com: `Z056199436UPE16L99RD1`

## Deploying Changes

### To zanestiles.com:
```bash
aws s3 sync public/ s3://zanestiles.com/
aws cloudfront create-invalidation --distribution-id E3BBASY76ZFTO7 --paths "/*"
```

### To cooperlemone.com:
```bash
aws s3 sync cooperlemone/public/ s3://cooperlemone.com/
aws cloudfront create-invalidation --distribution-id E48TF22UWGVG9 --paths "/*"
```

## Key Dates (in JavaScript)

```javascript
const BP_BIRTHDAY = new Date('2026-01-17T12:00:00');
const PROLE_BIRTHDAY = new Date('2026-01-24T12:00:00');
const BET_START = new Date('2026-01-26T00:00:00');
```

## Project Structure

```
bp-tracker/
├── public/                  # zanestiles.com static files
│   ├── scoreboard.html      # Main contest scoreboard
│   ├── feeding.html         # Feeding log
│   ├── live.html            # Live camera feed
│   ├── css/style.css
│   ├── js/
│   └── images/
├── cooperlemone/
│   └── public/              # cooperlemone.com static files
│       ├── index.html       # Divvy memorial/taunt page
│       └── images/
│           └── dead_divvy.jpg
└── aws/                     # Lambda for feeding API
```

## The Lair

Junior employees at Bain Capital. One member is Cooper LeMone (hence cooperlemone.com).
