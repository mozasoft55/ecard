# Apps Script deployment

The invitation site reads wedding data from the Apps Script web app configured in `api.js`. RSVP submissions use the same web-app URL through `doPost`.

After updating `Code.gs`:

1. Open the Apps Script project bound to the wedding spreadsheet and replace its code with this file.
2. Deploy the web app as a **new version**, keeping the existing deployment URL.
3. Keep the existing access policy that lets invited guests open the wedding data and submit an RSVP.
4. On the first valid response, the script creates an `RSVPs` sheet with these columns:
   `submitted_at`, `wedding_id`, `slug`, `invitation_id`, `guest_name`, `response`, `attendees`, `capacity`.
5. If an `RSVPs` sheet already exists, its first row must use those exact headers; the script rejects unexpected columns instead of writing into an unrelated sheet.

RSVP is a public-link workflow: anyone who has a guest invitation link can submit or update the response associated with that link. Do not store sensitive information in the RSVP sheet.

Run the local regression suite from the project folder with `npm install` followed by `npm test`.
