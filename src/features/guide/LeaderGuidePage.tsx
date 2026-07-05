import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-amber-900">
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

export function LeaderGuidePage() {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <Card className="mx-auto max-w-2xl shadow-sm">
      <CardContent className="px-6 py-8 text-base leading-relaxed text-foreground sm:px-10 sm:py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Sub-Group Leader Guide</h1>
          <p className="mt-2 text-muted-foreground">
            A quick guide to registering your people and recording payments for camp.
          </p>
          <div className="mt-4">
            <Link
              to="/login"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Back to sign in
            </Link>
          </div>
        </div>

        <hr className="border-border" />

        {/* What you'll do */}
        <Section title="What you'll do">
          <p className="mb-3">Two things:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li><strong>Register the people in your sub-group</strong> — fill in their details.</li>
            <li><strong>Mark who has paid</strong> — once someone gives you their camp fee.</li>
          </ol>
          <p className="mt-3">
            Everyone you register is automatically tied to <em>your</em> sub-group. You don't pick
            a group — the system already knows which one is yours.
          </p>
        </Section>

        {/* Getting your login */}
        <Section title="Getting your login">
          <p className="mb-3">
            You'll receive an email inviting you to set a password. Click the link, choose a
            password, and you're in. If you didn't get the email, check spam, then contact the
            camp admin — they can resend it.
          </p>
          <p>
            To sign in later, go to the app and log in with your email and the password you set.
            Forgot it? Use <strong>"Reset password"</strong> on the login screen.
          </p>
        </Section>

        {/* Registering someone */}
        <Section title="Registering someone">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Log in and open your registration page.</li>
            <li>Fill in the participant's details (name, phone, and the other fields shown).</li>
            <li>Submit. They're now registered under your sub-group.</li>
          </ol>
          <p className="mt-3">
            You'll see your registered people in your list. You can register as many as you need,
            one at a time.
          </p>
        </Section>

        {/* Marking who paid */}
        <Section title="Marking who paid">
          <p className="mb-3">When someone gives you their camp fee:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Find them in your list.</li>
            <li>Tap <strong>"Mark paid."</strong></li>
          </ol>
          <p className="mt-3">
            There are no amounts to type — each person's fee is already set. You're simply saying
            "this person has paid me."
          </p>
          <Callout>
            <p className="font-semibold">What "Mark paid" really means</p>
            <p className="mt-1">
              Marking someone paid is you telling the system <em>"I've collected this person's
              money."</em> It is <strong>not</strong> the final word. Their payment becomes final
              only after you hand the money over to the admin and it's checked against your list.
              Until then, it's a claim — an honest record of who's paid <em>you</em>, not yet
              confirmed by the office.
            </p>
            <p className="mt-2">
              You can un-mark someone if you tap by mistake, or if it turns out they hadn't
              actually paid. Please keep your list honest — it's what everything else depends on.
            </p>
          </Callout>
        </Section>

        {/* Handing over money */}
        <Section title="Handing over money">
          <p className="mb-3">
            You collect your sub-group's fees, then hand the total over to the admin as one lump
            sum (cash or mobile money, as arranged). The admin checks the amount you hand over
            against the people you've marked paid. <strong>The two must match.</strong>
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              If the total you hand over <strong>equals</strong> the fees of everyone you marked
              paid → everyone is confirmed. Done.
            </li>
            <li>
              If it <strong>doesn't match</strong> (you handed over more or less than your
              marked-paid list adds up to) → nobody in that batch is confirmed yet, and you and
              the admin will sort out the difference together.
            </li>
          </ul>
          <Callout>
            <p>
              This is why keeping your marked-paid list accurate matters: if you mark 20 people
              paid but hand over money for only 18, the system can't confirm anyone until it's
              resolved.{' '}
              <strong>Only mark people paid once they've actually paid you.</strong>
            </p>
          </Callout>
        </Section>

        {/* Registration paused */}
        <Section title='"Registration is paused for your group"'>
          <p className="mb-3">
            Sometimes you'll open your registration page and see a message that registration is{' '}
            <strong>paused</strong>, instead of the form.
          </p>
          <p className="mb-3">
            This is normal. It happens when there's money for your group still being reconciled —
            a hand-over that hasn't been matched up yet. It's a deliberate pause to keep your
            group's records clean.
          </p>
          <p>
            <strong>What to do:</strong> wait for the admin to finish reconciling, or check in
            with them. Once it's sorted, your registration form comes back automatically. Nothing
            is broken.
          </p>
        </Section>

        {/* Short version */}
        <Section title="The short version">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You register your people — they're tied to your group automatically.</li>
            <li>You mark people paid <strong>only after they've actually paid you.</strong></li>
            <li>"Paid" is your honest claim; it's confirmed once you hand the money over and it matches your list.</li>
            <li>Hand over a lump that matches your marked-paid people.</li>
            <li>If registration is "paused," a reconciliation is in progress — wait or ask the admin.</li>
          </ul>
        </Section>

        {/* Footer */}
        <div className="mt-10 border-t pt-6 text-sm text-muted-foreground">
          <p>Questions? Contact the camp admin. Thank you for helping camp run smoothly.</p>
          <p className="mt-3">
            <Link
              to="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in →
            </Link>
          </p>
        </div>

      </CardContent>
      </Card>
    </div>
  )
}
