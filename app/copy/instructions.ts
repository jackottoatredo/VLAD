/**
 * Page instructions in markdown. Edit freely — supports **bold**, *italic*,
 * lists, links, and `inline code`. Rendered via <Markdown> from
 * app/components/Markdown.tsx.
 */

export const home = `
Generate personalized outreach at scale following three easy steps:
`

export const productRecord = `

Select a **product** and click **start recording**. 

**The webpage is interactive -->**

Your mouse, keyboard, webcam and audio will be recorded.

**❌ Do not say or click anything merchant specific** this recording will be duplicated for many merchants.

---

***tip:*** _spend <1 second on the welcome page, merchant intros will take place there._

***tip:*** _refresh or relaunch vlad if you do not see your webcam. Make sure you click allow when prompted._
`

export const productPostprocess = `
***Why Rendering?***

VLAD reproduces your website interaction in a virtual browser. This is how we can inject merchant specific content.

---

**Review the Rendering** to make sure the website behaves the same as what you recorded. 

*Small timing errors can sometimes occur*.

Use the **Clipping Tool** to trim the beginning and end of your video

---

***tip:*** _leave a very short pause (<0.5 sec) before audio begins so that transition from intro into this recording is natural._

***tip:*** _Make sure the webcam is visible on frame 1. webcam is sometimes a few frames late._ 
`

export const productPreview = `
**Review Example Merchant Customizations:**
- Do the renderings follow the same flow?
- Does the audio make sense in all contexts?
- Does the audio align with the rendering?

If yes, click **save**
`

export const merchantRecord = `

Select or add a **merchant** and click **start recording**. 

**The webpage is interactive -->**

Your mouse, keyboard, webcam and audio will be recorded.

**✔ Be merchant specific** make your customers feel special 🧡

---

***tip:*** _Review the product recording onto which this intro is prepended to keep the flow natural._

***tip:*** _Make sure the intro ends on the same page that your product recording begins. Easiest to stay on the welcome page._

***tip:*** _If the merchant content is wrong or a bit ugly you can edit that [here](https://search-redo-internal-replit.replit.app/previews)_
`

export const merchantPostprocess = `

**Review the Rendering** to make sure the website behaves the same as what you recorded. 

Use the **Clipping Tool** to trim the beginning and end of your video

---

***tip:*** _leave little to no pause (<0.2 sec) after ends that the transition from this recording into the product recording is natural._

***tip:*** _Make sure the webcam is visible on frame 1. webcam is sometimes a few frames late._ 
`

export const mergeExport = `
Review and Manage all your recordings.

To start a rendering task hit **+** in the **Rendering Tasks** Panel
- Select **one or more** intros, and **one** product recording.
- VLAD will combine the two with merchant specific content throughout the video.
- Go ahead and record some more, come back and download them when they are done.
`
