https://search.redo.com/brands/mammut.com?products=returns-claims,checkout-optimization,order-editing,shipping-fulfillment,agentic-catalog,ai-sales-support,email-sms,recover,order-tracking,chargebacks,warranties,inventory-management

---------------------

I want to add a new page to the flow which falls between the product recording and product preview sections named product postprocessing. This will be a direct replay of what the user has just recorded, and will give simple editing tool to crop in the ends of the video. It requires a slight change to the existing pipeline. We currently record webcam + mouse, but id like to also save a screenrecording of the target website (the content of the iframe as a video). In this way we can skip the rendering and directly composite the screen recording with the webcam. Then the user can apply a crop (we simply store the start and end times to our metadata). After the user is satisfied with the cropped video they can proceed to the product preview page which renders 4 new simulated screen recordings with playwright. These we render then composite. In summary the new page is a quick preview so the user can review his audio and crop the video. If satisfied he validates the recording on 4 produced videos. If he likes all four he can name and save.


-----------------
great lets plan out the right methodology for managing temporary files, tabular data and long term media storage. Here are my thoughts:

1) There are two groups of media that we need to keep long term. 
1a) After the recording step we will keep a temporary storage of the most recent recording (metadata.json, mouse.json, webcam.webm)
1b) After the product review step users can name and save a video file.

----------------

