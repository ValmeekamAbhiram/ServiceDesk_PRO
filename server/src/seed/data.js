/**
 * ServiceDesk Pro — seed content.
 *
 * Everything hand-written lives here, separated from `seed.ts` which decides how it is
 * assembled. The split is worth a file because the two change for different reasons:
 * fixing a typo in an article, or adding a category, should not mean reading the
 * lifecycle simulator.
 *
 * Three things in here are load-bearing rather than decorative:
 *
 *  - **Category `keywords`.** The offline ticket classifier scores a title against the
 *    category name plus these terms. If they were left empty the suggestion panel would
 *    still work but would always answer "this is a guess", so the one AI-assisted
 *    feature in the build would demo as broken. The ticket titles below are written to
 *    match them.
 *  - **Ticket `template.category`.** A slug, resolved to a real id at seed time. Writing
 *    the slug rather than an index means reordering the category list cannot silently
 *    file every printer fault under Network.
 *  - **`draft: true` on one article.** The knowledge base's review boundary is only
 *    visible if something is actually unpublished, so an EMPLOYEE signing in finds four
 *    articles where an ADMIN finds five.
 */
import { AssetStatus, AssetType, Priority, Role } from '@shared/enums';
/**
 * The first three are the documented demo logins printed at the end of a seed run; the
 * rest exist so the queue has more than three names in it. Every one of them shares
 * `SEED_PASSWORD` — see the warning in `run.ts`.
 */
export const PEOPLE = [
    { name: 'Ada Menon', email: 'admin@servicedesk.local', role: Role.ADMIN, jobTitle: 'IT Service Manager', phone: '+91 80 4000 1001' },
    { name: 'Ravi Iyer', email: 'tech@servicedesk.local', role: Role.TECHNICIAN, jobTitle: 'Support Engineer', phone: '+91 80 4000 1002' },
    { name: 'Priya Nair', email: 'employee@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Accounts Executive', phone: '+91 80 4000 1003' },
    { name: 'Karthik Rao', email: 'karthik.rao@servicedesk.local', role: Role.TECHNICIAN, jobTitle: 'Network Engineer', phone: '+91 80 4000 1010' },
    { name: 'Sneha Kulkarni', email: 'sneha.kulkarni@servicedesk.local', role: Role.TECHNICIAN, jobTitle: 'Desktop Support', phone: '+91 80 4000 1011' },
    { name: 'Imran Shaikh', email: 'imran.shaikh@servicedesk.local', role: Role.TECHNICIAN, jobTitle: 'Systems Administrator', phone: null },
    { name: 'Meera Krishnan', email: 'meera.krishnan@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'HR Generalist', phone: '+91 80 4000 1020' },
    { name: 'Arjun Desai', email: 'arjun.desai@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Sales Manager', phone: '+91 80 4000 1021' },
    { name: 'Fatima Sheikh', email: 'fatima.sheikh@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Finance Analyst', phone: null },
    { name: 'Nikhil Verma', email: 'nikhil.verma@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Warehouse Supervisor', phone: '+91 80 4000 1023' },
    { name: 'Divya Pillai', email: 'divya.pillai@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Marketing Associate', phone: null },
    { name: 'Rohan Gupta', email: 'rohan.gupta@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Procurement Officer', phone: '+91 80 4000 1025' },
    { name: 'Anita Bose', email: 'anita.bose@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Legal Counsel', phone: null },
    { name: 'Suresh Babu', email: 'suresh.babu@servicedesk.local', role: Role.EMPLOYEE, jobTitle: 'Facilities Lead', phone: '+91 80 4000 1027' },
];
/**
 * `defaultPriority` is what a ticket gets when the reporter does not choose one, so it
 * is also what the suggestion panel proposes. Network is HIGH because a floor with no
 * connectivity is a floor that has stopped working; Access is MEDIUM because a locked
 * account is urgent to one person and routine to the desk.
 */
export const CATEGORIES = [
    {
        slug: 'network',
        name: 'Network & Connectivity',
        description: 'Wi-Fi, VPN, cabling, and anything that will not reach the internet.',
        color: '#2563eb',
        defaultPriority: Priority.HIGH,
        sortOrder: 10,
        keywords: ['wifi', 'wi-fi', 'vpn', 'internet', 'network', 'ethernet', 'lan', 'router', 'switch', 'dns', 'slow connection', 'cannot connect', 'no internet', 'dropping'],
    },
    {
        slug: 'hardware',
        name: 'Hardware',
        description: 'Laptops, desktops, monitors, docks, keyboards and batteries.',
        color: '#c2410c',
        defaultPriority: Priority.MEDIUM,
        sortOrder: 20,
        keywords: ['laptop', 'desktop', 'monitor', 'screen', 'keyboard', 'mouse', 'dock', 'battery', 'charger', 'overheating', 'blue screen', 'will not boot', 'fan noise', 'cracked'],
    },
    {
        slug: 'software',
        name: 'Software & Applications',
        description: 'Installs, licences, updates, crashes and Office problems.',
        color: '#7c3aed',
        defaultPriority: Priority.MEDIUM,
        sortOrder: 30,
        keywords: ['software', 'application', 'excel', 'outlook', 'teams', 'install', 'licence', 'license', 'update', 'crash', 'freezing', 'error message', 'add-in', 'browser'],
    },
    {
        slug: 'access',
        name: 'Accounts & Access',
        description: 'Passwords, lockouts, MFA, shared drives and permissions.',
        color: '#0f766e',
        defaultPriority: Priority.MEDIUM,
        sortOrder: 40,
        keywords: ['password', 'reset', 'locked out', 'lockout', 'login', 'log in', 'mfa', 'two-factor', 'account', 'access', 'permission', 'shared drive', 'folder', 'sso'],
    },
    {
        slug: 'printing',
        name: 'Printing',
        description: 'Printers, queues, drivers, scanning and consumables.',
        color: '#a16207',
        defaultPriority: Priority.LOW,
        sortOrder: 50,
        keywords: ['printer', 'print', 'printing', 'scan', 'scanner', 'toner', 'paper jam', 'queue', 'driver', 'duplex'],
    },
    {
        slug: 'email',
        name: 'Email',
        description: 'Mailboxes, distribution lists, spam and calendar invitations.',
        color: '#be185d',
        defaultPriority: Priority.MEDIUM,
        sortOrder: 60,
        keywords: ['email', 'mailbox', 'inbox', 'spam', 'phishing', 'calendar', 'invite', 'distribution list', 'signature', 'attachment', 'quota'],
    },
    {
        slug: 'telephony',
        name: 'Desk Phones',
        description: 'Retired in 2025 when the floor moved to softphones.',
        color: '#64748b',
        defaultPriority: Priority.LOW,
        sortOrder: 900,
        keywords: ['desk phone', 'handset', 'extension', 'voicemail'],
        inactive: true,
    },
];
/**
 * Sized to the fourteen people above rather than to `SEED_ASSET_COUNT`: this list is
 * the *named* estate, and `seed.ts` tops it up with generated spares to reach the
 * configured count. Three of the warranty dates are deliberately in the next six weeks
 * so the dashboard's warranty radar has something to show, and one has already lapsed.
 */
export const ASSETS = [
    { name: 'Ada — ThinkPad X1', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Lenovo', model: 'ThinkPad X1 Carbon G11', location: 'Bengaluru / 4F', warrantyMonths: 14, purchaseMonthsAgo: 10, purchaseCost: 168_000, holder: 0 },
    { name: 'Ravi — Latitude 5440', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'Latitude 5440', location: 'Bengaluru / 4F', warrantyMonths: 1, purchaseMonthsAgo: 23, purchaseCost: 92_000, holder: 1 },
    { name: 'Priya — Latitude 3540', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'Latitude 3540', location: 'Bengaluru / 2F', warrantyMonths: 8, purchaseMonthsAgo: 16, purchaseCost: 71_500, holder: 2 },
    { name: 'Karthik — MacBook Pro 14', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Apple', model: 'MacBook Pro 14 M3', location: 'Bengaluru / 4F', warrantyMonths: 19, purchaseMonthsAgo: 5, purchaseCost: 214_000, holder: 3 },
    { name: 'Sneha — ThinkPad L14', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Lenovo', model: 'ThinkPad L14 G4', location: 'Bengaluru / 4F', warrantyMonths: 11, purchaseMonthsAgo: 13, purchaseCost: 84_000, holder: 4 },
    { name: 'Meera — Latitude 3540', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'Latitude 3540', location: 'Bengaluru / 3F', warrantyMonths: 2, purchaseMonthsAgo: 22, purchaseCost: 71_500, holder: 6 },
    { name: 'Arjun — ThinkPad E14', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Lenovo', model: 'ThinkPad E14 G5', location: 'Mumbai / Sales', warrantyMonths: -3, purchaseMonthsAgo: 27, purchaseCost: 66_000, holder: 7 },
    { name: 'Fatima — OptiPlex 7010', type: AssetType.DESKTOP, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'OptiPlex 7010 SFF', location: 'Bengaluru / 2F', warrantyMonths: 16, purchaseMonthsAgo: 8, purchaseCost: 58_000, holder: 8 },
    { name: 'Nikhil — Latitude 5440', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'Latitude 5440', location: 'Hosur / Warehouse', warrantyMonths: 13, purchaseMonthsAgo: 11, purchaseCost: 92_000, holder: 9 },
    { name: 'Divya — MacBook Air 13', type: AssetType.LAPTOP, status: AssetStatus.IN_USE, manufacturer: 'Apple', model: 'MacBook Air 13 M2', location: 'Bengaluru / 3F', warrantyMonths: 6, purchaseMonthsAgo: 18, purchaseCost: 118_000, holder: 10 },
    { name: 'Meeting room display — Ellora', type: AssetType.MONITOR, status: AssetStatus.IN_USE, manufacturer: 'LG', model: '55UR640S', location: 'Bengaluru / 4F Ellora', warrantyMonths: 21, purchaseMonthsAgo: 3, purchaseCost: 74_000, holder: null },
    { name: 'Finance floor printer', type: AssetType.PRINTER, status: AssetStatus.IN_USE, manufacturer: 'HP', model: 'LaserJet M479fdw', location: 'Bengaluru / 2F', warrantyMonths: 5, purchaseMonthsAgo: 19, purchaseCost: 46_000, holder: null },
    { name: 'Warehouse label printer', type: AssetType.PRINTER, status: AssetStatus.IN_REPAIR, manufacturer: 'Zebra', model: 'ZT411', location: 'Hosur / Warehouse', warrantyMonths: 9, purchaseMonthsAgo: 15, purchaseCost: 132_000, holder: null },
    { name: 'Core switch — 4F', type: AssetType.NETWORK, status: AssetStatus.IN_USE, manufacturer: 'Cisco', model: 'Catalyst 9200L', location: 'Bengaluru / 4F comms', warrantyMonths: 30, purchaseMonthsAgo: 6, purchaseCost: 290_000, holder: null },
    { name: 'Wireless controller', type: AssetType.NETWORK, status: AssetStatus.IN_USE, manufacturer: 'Ubiquiti', model: 'UDM Pro', location: 'Bengaluru / 4F comms', warrantyMonths: 4, purchaseMonthsAgo: 20, purchaseCost: 42_000, holder: null },
    { name: 'File server', type: AssetType.SERVER, status: AssetStatus.IN_USE, manufacturer: 'Dell', model: 'PowerEdge R450', location: 'Bengaluru / 4F comms', warrantyMonths: 26, purchaseMonthsAgo: 10, purchaseCost: 520_000, holder: null },
    { name: 'Spare laptop — pool A', type: AssetType.LAPTOP, status: AssetStatus.IN_STOCK, manufacturer: 'Lenovo', model: 'ThinkPad L14 G4', location: 'Bengaluru / IT store', warrantyMonths: 22, purchaseMonthsAgo: 2, purchaseCost: 84_000, holder: null },
    { name: 'Spare laptop — pool B', type: AssetType.LAPTOP, status: AssetStatus.IN_STOCK, manufacturer: 'Lenovo', model: 'ThinkPad L14 G4', location: 'Bengaluru / IT store', warrantyMonths: 22, purchaseMonthsAgo: 2, purchaseCost: 84_000, holder: null },
    { name: 'Retired desk phone batch', type: AssetType.PHONE, status: AssetStatus.RETIRED, manufacturer: 'Cisco', model: 'IP Phone 7841', location: 'Bengaluru / IT store', warrantyMonths: null, purchaseMonthsAgo: 60, purchaseCost: 9_000, holder: null },
    { name: 'Reception iPad', type: AssetType.OTHER, status: AssetStatus.IN_USE, manufacturer: 'Apple', model: 'iPad 10th gen', location: 'Bengaluru / Reception', warrantyMonths: 3, purchaseMonthsAgo: 21, purchaseCost: 38_000, holder: 13 },
];
/*
 * Bodies use only the Markdown subset the client renderer supports — headings, bold,
 * inline code, bullet and numbered lists, quotes and fenced blocks. Anything else would
 * render as literal text, which is a readable failure but a scruffy one in a demo.
 */
export const ARTICLES = [
    {
        title: 'Connect to the office VPN',
        summary: 'Step-by-step VPN setup for Windows and macOS, and what to try first when it will not connect.',
        category: 'network',
        tags: ['vpn', 'remote', 'network'],
        views: 412,
        body: `## Before you start

You need your work email address, your usual password, and the authenticator app on your phone.

## Set it up

1. Open **Company Portal** and install *GlobalConnect VPN*.
2. Launch it and enter the server address \`vpn.northwind.local\`.
3. Sign in with your work email. Approve the push notification on your phone.
4. Wait for the icon to turn green. You are on the office network.

## If it will not connect

- Turn off any personal VPN or ad-blocking DNS first. Two VPNs cannot share one adapter.
- On hotel or airport Wi-Fi, open a browser and finish the captive-portal login before starting the VPN.
- If it says **authentication failed**, your password may have expired — reset it and try again.
- Still stuck? Raise a ticket under *Network & Connectivity* and include the exact error text.

> The VPN drops idle sessions after 8 hours. Reconnecting each morning is expected, not a fault.`,
    },
    {
        title: 'Reset a forgotten password',
        summary: 'Use the self-service portal to reset your own password in about two minutes, and what to do if you are locked out entirely.',
        category: 'access',
        tags: ['password', 'access', 'mfa'],
        views: 587,
        body: `## Reset it yourself

1. Go to the sign-in page and choose **Forgotten your password?**
2. Enter your work email address.
3. Approve the prompt in your authenticator app.
4. Choose a new password: at least 8 characters, with letters and numbers.

The new password applies everywhere within a few minutes — laptop, email and Wi-Fi.

## If you are locked out

Five wrong attempts locks the account for 15 minutes. Wait it out; the lock clears on its own.

If you have lost the phone with your authenticator on it, self-service cannot help — the desk has to verify who you are in person. Come to 4F with your ID card, or raise a ticket under *Accounts & Access* and a technician will call you back.

## Choosing a password

- Longer beats complicated. Three unrelated words are stronger than \`P@ssw0rd\`.
- Never reuse your work password on a personal site.
- We will never ask for it. Nobody from IT will phone and ask you to read it out.`,
    },
    {
        title: 'Printer says "offline" but the light is on',
        summary: 'The three checks that fix most "printer offline" reports, in the order worth trying them.',
        category: 'printing',
        tags: ['printer', 'printing', 'driver'],
        views: 233,
        body: `Nine times in ten the printer is fine and the queue is stuck.

## 1. Clear the queue

Open **Settings -> Bluetooth & devices -> Printers**, choose the printer, then **Open print queue** and cancel every waiting job. A single failed job blocks everything behind it.

## 2. Turn "use printer offline" back off

Same screen, then **Printer -> Use Printer Offline**. If it is ticked, untick it. Windows sets this by itself after a network blip and never unsets it.

## 3. Check you are on the office network

The floor printers are not reachable from home or over guest Wi-Fi. Connect the VPN first.

## Still offline

Note the printer's name from the label on its lid and raise a ticket under *Printing*. Include:

- the printer name,
- the exact wording on its own screen,
- whether anyone else on your floor can print.

> Paper jams and toner do not need a ticket. Toner is in the 2F store cupboard.`,
    },
    {
        title: 'Laptop running hot and slow',
        summary: 'What to check before assuming the hardware is failing, including the one Windows setting that causes most of it.',
        category: 'hardware',
        tags: ['laptop', 'performance', 'hardware'],
        views: 178,
        body: `## Check the obvious first

- Is it sitting on a bed, sofa or bag? The intake vents are on the underside and need a hard surface.
- Has Windows been updating in the background? Look for the update icon in the tray and let it finish.
- Open **Task Manager** (Ctrl+Shift+Esc) and sort by CPU. One runaway browser tab explains a lot of "slow laptop" reports.

## The setting that matters

**Settings -> System -> Power & battery -> Power mode.** On *Best performance* the fans run constantly on battery. *Balanced* is the right default for a laptop.

## When it is really the hardware

Raise a ticket under *Hardware* if any of these are true:

1. It shuts down on its own without warning.
2. The fan is audible from a metre away while idle.
3. The battery reports under 60% health in \`powercfg /batteryreport\`.

Include your asset tag — it is on the sticker under the laptop, in the form \`AST-0001\`.`,
    },
    {
        title: 'Recognising a phishing email',
        summary: 'Four signals that an email is not what it claims, and exactly what to do with it.',
        category: 'email',
        tags: ['phishing', 'email', 'security'],
        views: 341,
        body: `## Four signals

1. **Urgency.** "Your account will be closed in 24 hours." Real notices do not set deadlines in hours.
2. **A mismatched sender.** Hover the display name and read the actual address. \`accounts@northwind-payroll.co\` is not us.
3. **An unexpected attachment.** Especially \`.zip\`, \`.htm\` or anything asking you to "enable content".
4. **A link that does not go where it says.** Hover it and read the status bar before clicking.

## What to do

- Do **not** reply, click, or open the attachment.
- Use the **Report Phishing** button in Outlook. That sends it to the desk and removes it from your inbox.
- If you already clicked and entered your password, change it immediately and raise a ticket under *Accounts & Access*. Say what happened plainly — nobody is in trouble for reporting it quickly.

> IT will never email you asking for your password, and will never ask you to move money.`,
    },
    {
        title: 'Standard laptop refresh checklist',
        summary: 'Internal runbook for swapping a user onto a new machine. Draft — the encryption step still needs review.',
        category: 'hardware',
        tags: ['runbook', 'onboarding', 'hardware'],
        draft: true,
        views: 4,
        body: `**Draft.** Do not follow this yet: the disk-encryption step below has not been checked against the new imaging process.

## Before the swap

1. Confirm the replacement in the asset register and note both tags.
2. Check the outgoing machine's warranty status — an in-warranty fault is a vendor job, not a refresh.
3. Ask the user what is stored locally. There is always something.

## The swap

1. Image the new machine from the standard build.
2. Verify disk encryption is on and the recovery key has escrowed. **Needs review: which console is authoritative now?**
3. Move the user's profile and confirm they can sign in, reach the file server, and print.
4. Reassign the asset record to the user and set the old machine to *In stock*.

## After

- Wipe the old machine before it goes back on the shelf.
- Close the ticket only once the user confirms, not once the laptop is handed over.`,
    },
];
/**
 * Eighteen shapes of real work, reused with different requesters and dates. Titles are
 * written to hit the category keywords above — that is what makes the suggestion panel
 * demonstrable — and each carries enough conversation that a ticket page has something
 * on it besides the description.
 */
export const TICKET_TEMPLATES = [
    {
        category: 'network',
        title: 'VPN disconnects every few minutes from home',
        description: 'Since Monday the VPN drops roughly every five minutes. It reconnects on its own but anything I have open on the file server fails in the meantime. Home broadband is otherwise fine — video calls on the same connection are stable.',
        replies: [
            'Thanks for the detail. That pattern usually means the tunnel is competing with something else on the adapter. Could you check whether your router has an IPsec or VPN passthrough setting enabled?',
            'That confirms it. I have moved your profile onto the TCP fallback endpoint — please disconnect, quit the client entirely, and sign back in.',
        ],
        notes: ['Third report this week on the same ISP. Worth raising with the vendor if a fourth arrives.'],
        resolution: 'Moved the user to the TCP fallback VPN endpoint. Stable across a full working day since.',
    },
    {
        category: 'network',
        title: 'No internet on the 2F meeting rooms',
        description: 'Nobody in Ellora or Hampi can get online — laptops show connected to the wifi but no internet. Wired ports in the same rooms work. We have a client call in an hour.',
        priority: Priority.URGENT,
        replies: [
            'On it now. Please use the wired ports for the call while I look at the access points on that side of the floor.',
            'The access point serving both rooms had stopped handing out addresses. It is restarted and I can see clients associating again — could you confirm?',
        ],
        notes: ['AP-2F-03 had a stuck DHCP relay. Firmware is two releases behind; scheduling the upgrade out of hours.'],
        resolution: 'Restarted AP-2F-03 and confirmed DHCP leases. Firmware upgrade scheduled separately.',
    },
    {
        category: 'network',
        title: 'Wifi very slow in the warehouse office',
        description: 'Downloads that take seconds upstairs take minutes here. It has been getting worse since the new racking went in.',
        replies: [
            'The new racking is almost certainly the cause — metal shelving between you and the access point. I will come down with a survey tool this afternoon.',
        ],
        resolution: 'Added a second access point on the far wall after a site survey. Throughput back to expected levels.',
    },
    {
        category: 'hardware',
        title: 'Laptop will not boot — blue screen on startup',
        description: 'Powers on, shows the logo, then a blue screen with INACCESSIBLE_BOOT_DEVICE and restarts in a loop. It was working when I shut it down last night. I have a report due today.',
        priority: Priority.HIGH,
        linkAsset: 'requester',
        replies: [
            'Bring it up to 4F whenever you can and I will put you on a loan machine straight away so you are not blocked.',
            'Your files are safe — everything in your documents folder was syncing. The loan laptop is signed in and ready.',
        ],
        notes: ['Failed after the 24H2 update. Rolled back from recovery; disk health is fine.'],
        resolution: 'Rolled the failed Windows update back from recovery. Machine boots normally and the user is back on it.',
    },
    {
        category: 'hardware',
        title: 'Monitor flickers when the dock is connected',
        description: 'The external monitor flickers about once a minute, but only through the dock. Straight into the laptop it is perfectly steady.',
        linkAsset: 'requester',
        replies: [
            'That points at the cable or the dock rather than the monitor. Could you try the spare DisplayPort cable in the 2F store cupboard?',
        ],
        resolution: 'Replaced a failing DisplayPort cable between the dock and the monitor.',
    },
    {
        category: 'hardware',
        title: 'Laptop battery drains in about an hour',
        description: 'Down from most of a day when it was new. It also runs hot enough that I cannot keep it on my lap.',
        linkAsset: 'requester',
        replies: [
            'A battery report will tell us where it stands. Please run `powercfg /batteryreport` and attach the file it writes.',
            'Design capacity 47%, so the battery is genuinely worn rather than mis-reporting. It is in warranty — I have logged the replacement with the vendor.',
        ],
        notes: ['Vendor case NW-88214. Two to three working days for the part.'],
        resolution: 'Battery replaced under warranty. Health back to 98% and the fan noise has gone with it.',
    },
    {
        category: 'software',
        title: 'Excel crashes when opening the monthly close file',
        description: 'Excel closes without a message roughly ten seconds after opening it. Other spreadsheets are fine. The file opens on my colleague\u2019s machine.',
        priority: Priority.HIGH,
        replies: [
            'Since it opens elsewhere the file is probably fine and the add-ins are the suspect. Could you try File -> Options -> Add-ins and disable the third-party ones?',
            'Good — that narrows it to the reporting add-in. I have removed the old version and installed the current one.',
        ],
        resolution: 'Removed an out-of-date reporting add-in and installed the supported version. File opens normally.',
    },
    {
        category: 'software',
        title: 'Teams will not share my screen',
        description: 'Sharing shows a black rectangle to everyone else. Camera and microphone work. Started after last week\u2019s update.',
        replies: [
            'Known problem with the hardware-acceleration setting after that update. Please untick Settings -> General -> Disable GPU hardware acceleration, then quit Teams from the tray and reopen it.',
        ],
        resolution: 'Turned off GPU hardware acceleration in Teams, which is the documented workaround for this build.',
    },
    {
        category: 'software',
        title: 'Need Power BI Desktop installed',
        description: 'Finance is moving the monthly pack to Power BI and I need the desktop application to edit the reports.',
        priority: Priority.LOW,
        replies: [
            'Happy to install it. It is on the approved list so no licence request is needed — I will push it from the portal and it will appear within the hour.',
        ],
        resolution: 'Deployed Power BI Desktop from Company Portal and confirmed it opens the shared report.',
    },
    {
        category: 'access',
        title: 'Locked out after too many password attempts',
        description: 'I mistyped my password a few times and now it says my account is locked. I have a payroll deadline this afternoon.',
        priority: Priority.HIGH,
        replies: [
            'The lock clears automatically after 15 minutes. I have also cleared it manually now, so try signing in again.',
        ],
        resolution: 'Cleared the account lockout. The user signed in successfully and no reset was needed.',
    },
    {
        category: 'access',
        title: 'Cannot open the shared Finance drive',
        description: 'The F: drive shows a red cross and says access denied. It worked last week. Colleagues on the same team can still open it.',
        replies: [
            'You came off the Finance security group when your job title changed last month. I have requested the group be restored — your manager needs to approve it, which I have asked for.',
            'Approved and applied. Please sign out and back in so your machine picks up the new group.',
        ],
        notes: ['Not a fault: the role change removed the group. Worth flagging to HR that the leaver/mover checklist misses this.'],
        resolution: 'Restored Finance group membership after manager approval. Drive maps again after a sign-out.',
    },
    {
        category: 'access',
        title: 'New starter needs an account — starts Monday',
        description: 'Sana Qureshi joins the marketing team on Monday. She needs email, the shared drive and access to the design tools.',
        priority: Priority.LOW,
        replies: [
            'Noted. I will have the account, mailbox and drive access ready by Friday afternoon and leave the laptop with reception.',
        ],
        notes: ['Design tool licence needs a purchase order — raised with procurement so it does not block day one.'],
        resolution: 'Account, mailbox and drive access created. Laptop imaged and left with reception for Monday.',
    },
    {
        category: 'printing',
        title: 'Finance printer says offline',
        description: 'The printer shows offline on my machine although its own screen says ready. Nobody on the floor can print.',
        replies: [
            'There were eleven stuck jobs in the queue. I have cleared them and restarted the print spooler — please try again.',
        ],
        resolution: 'Cleared a blocked print queue and restarted the spooler on the print server.',
    },
    {
        category: 'printing',
        title: 'Scanned documents arrive blank',
        description: 'Scan to email works but every page comes through completely white. Photocopying on the same machine is fine.',
        priority: Priority.LOW,
        replies: [
            'Blank scans with working copies usually means the document glass or the feeder strip needs cleaning. I will come down and check it.',
        ],
        resolution: 'Cleaned the feeder strip, which had a dried ink mark across it, and confirmed a test scan.',
    },
    {
        category: 'printing',
        title: 'Warehouse label printer jamming constantly',
        description: 'Jams every third or fourth label. We are hand-writing labels to keep dispatch moving.',
        priority: Priority.HIGH,
        linkAsset: 'shared',
        replies: [
            'That is worth a vendor visit rather than another clear-out. I have logged it and asked for a same-week engineer.',
        ],
        notes: ['Printhead is out of alignment. Under warranty — vendor case ZB-40312.'],
        resolution: 'Vendor realigned the printhead on site and replaced the platen roller under warranty.',
    },
    {
        category: 'email',
        title: 'Mailbox is full and cannot send',
        description: 'Outlook says my mailbox is full. I can receive but not send. Most of it is old attachments I do not need.',
        replies: [
            'I have granted a temporary 5GB increase so you can send while you clear it down. Sorting by size in the search results is the quickest way to find the big ones.',
        ],
        resolution: 'Applied a temporary quota increase and showed the user how to clear large attachments.',
    },
    {
        category: 'email',
        title: 'Suspicious invoice email asking to change bank details',
        description: 'An email claiming to be from a supplier asks us to update their bank account before the next payment run. It looks close to their real address but not quite right. I have not replied.',
        priority: Priority.URGENT,
        replies: [
            'You did exactly the right thing by not replying. Please forward it with the Report Phishing button and do not action the request.',
            'Confirmed as a spoofed sender. It is blocked and removed from every mailbox that received it. Finance have been told to verify bank changes by phone against the number on file.',
        ],
        notes: ['Sender domain registered four days ago. Blocked at the gateway; six recipients, no clicks.'],
        resolution: 'Blocked the spoofed domain, purged the message from all mailboxes, and confirmed no bank details were changed.',
    },
    {
        category: 'email',
        title: 'Calendar invitations not reaching external guests',
        description: 'External attendees say they never receive my invitations. Internal colleagues get them fine.',
        replies: [
            'I can see them leaving our side, so they are being filtered on arrival. Could you send me one of the addresses that failed?',
        ],
        resolution: 'A misconfigured outbound rule was stripping calendar attachments to external recipients. Rule corrected.',
    },
    {
        category: 'hardware',
        title: 'Meeting room display shows no signal over HDMI',
        description: 'The screen in Ellora says no signal whatever laptop we plug in. It was working yesterday.',
        priority: Priority.HIGH,
        linkAsset: 'shared',
        replies: [
            'Someone has probably left it on the wrong input. I am nearby — I will check the source and the cable now.',
        ],
        resolution: 'Input had been left on the unused HDMI 2 port. Switched back and labelled the correct cable.',
    },
];
