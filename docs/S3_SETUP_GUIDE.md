# Detailed Guide: How to Get AWS Access Keys

The error `InvalidAccessKeyId` meant your previous keys were rejected by AWS. You need to generate a new pair of **Access Key ID** and **Secret Access Key**.

> [!NOTE]
> In AWS terms, an "Access Point" usually refers to a specific network feature, but what you need here are **Security Credentials (Access Keys)** for an IAM User. These keys act as the username/password for the code to access your S3 bucket.

---

## Part 1: Log in to AWS IAM
1.  Open your browser and go to the **[AWS Console](https://console.aws.amazon.com/)**.
2.  Log in to your AWS account.
3.  In the top-left search bar (at the very top of the page), type **`IAM`**.
4.  Click on **IAM (Manage access to AWS resources)** in the search results.

## Part 2: Create a New User (The Safest Way)
*If you already have a user, you can skip to Part 3, but creating a fresh one minimizes permission errors.*

1.  In the **left-hand sidebar** of the IAM dashboard, click **Users**.
2.  Click the orange **Create user** button (top right of the user list).
3.  **Step 1: Specify user details**
    *   **User name**: Type `switchboard-recorder`.
    *   **Provide user access to the AWS Management Console**: Leave this **unchecked**. (The app doesn't need to log in to the website, it just needs to upload files).
    *   Click **Next**.
4.  **Step 2: Set permissions**
    *   Select the box that says **Attach policies directly**.
    *   In the **Permissions policies** search box below, type `S3FullAccess`.
    *   Check the box next to the policy named **`AmazonS3FullAccess`**.
        *   *(Note: This gives the user full control over your buckets. For production security later, you can restrict this, but this is the "most robust" way to ensure it works now).*
    *   Click **Next**.
5.  **Step 3: Review and create**
    *   Click **Create user**.

## Part 3: Generate the Access Keys (The "Access Point")
Now we generate the specific keys the code needs.

1.  You should be back on the **Users** list. Click on the name of the user you just created: `switchboard-recorder`.
2.  Find the tab row (below the user summary info). Click the tab labeled **Security credentials**.
3.  Scroll down until you see the section titled **Access keys**.
4.  Click the **Create access key** button (right side of that section).
5.  **Access key best practices & alternatives**:
    *   Select **Application running outside AWS**.
    *   Click **Next**.
6.  **Description tag value**: You can leave this blank or type "For Switchboard App".
7.  Click **Create access key**.

## Part 4: Copy Your Keys (CRITICAL)
You will see a green success message: "Retrieve access keys".

**This is the ONLY time you will verify the Secret Key.**

1.  **Access key**: It will look like `AKIA...`
    *   Copy this string.
    *   Paste it into your `.env` file for `S3_ACCESS_KEY`.
2.  **Secret access key**: Click the "Show" button. It will look like a long random string (e.g., `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`).
    *   Copy this string.
    *   Paste it into your `.env` file for `S3_SECRET_KEY`.
3.  Click **Done**.

## Part 5: Verify Your Bucket Name
Double check that your bucket `handyuploaduk` actually exists in the `eu-west-2` (London) region.

1.  Search for **S3** in the top AWS search bar.
2.  Click **Buckets**.
3.  Find `handyuploaduk` in the list.
4.  Check the **AWS Region** column. It should say `EU (London) eu-west-2`.
    *   If it says something else (e.g., `us-east-1`), update `S3_REGION` in your `.env`.

---

## Summary of Changes to `.env`
Your `.env` file should look like this after update:

```bash
# S3 Configuration
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.eu-west-2.amazonaws.com
S3_BUCKET="handyuploaduk"
S3_REGION="eu-west-2"
S3_ACCESS_KEY="<THE_NEW_AKIA_KEY_YOU_COPIED>"
S3_SECRET_KEY="<THE_NEW_LONG_SECRET_KEY_YOU_COPIED>"
```

**Restart the server** (`npm run dev`) after saving the file.
