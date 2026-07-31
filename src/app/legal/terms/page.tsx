import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";
import { Faint, Section, Ul } from "../parts";

export const metadata: Metadata = {
  title: `利用規約 | ${LEGAL.serviceName}`,
  description: `${LEGAL.serviceName}の利用規約`,
};

export default function TermsPage() {
  return (
    <article>
      <h1 className="text-xl font-bold text-ink">利用規約</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink">
        本規約は、{LEGAL.operatorType}・{LEGAL.operatorName}（以下「運営者」）が提供するキッチンアプリ「
        {LEGAL.serviceName}」（以下「本サービス」）の利用条件を定めるものです。利用者は、本サービスを利用することで本規約に同意したものとみなされます。
      </p>

      <Section title="1. 本サービスの内容">
        <p>
          本サービスは、冷蔵庫の在庫と賞味期限の管理、AIによる献立の提案、買い物リストの作成などを行うアプリケーションです。運営者は、本サービスの内容を予告なく変更・追加・停止することがあります。
        </p>
      </Section>

      <Section title="2. アカウント">
        <Ul>
          <li>本サービスの利用にはアカウントの登録が必要です。</li>
          <li>
            利用者は、登録情報を正確に登録し、パスワードを自己の責任で管理するものとします。第三者への貸与・譲渡はできません。
          </li>
          <li>アカウントはアプリ内のマイページからいつでも削除できます。</li>
        </Ul>
      </Section>

      <Section title="3. AIによる提案・推定についての注意">
        <p>
          本サービスはAIを利用して賞味期限の推定やレシピの提案を行いますが、その内容の正確性・完全性・安全性を保証するものではありません。
        </p>
        <Ul>
          <li>
            <b>賞味期限・消費期限の推定は目安です。</b>
            実際に食べられるかどうかは、必ず現物とパッケージの表示を確認してご自身で判断してください。
          </li>
          <li>
            <b>アレルギー・食事制限がある方は、材料を必ずご自身で確認してください。</b>
            AIが提案するレシピには、アレルゲンを含む食材が含まれることがあります。
          </li>
          <li>
            レシピは加熱時間・衛生管理を含めて一般的な家庭調理を前提としています。調理は利用者ご自身の責任で行ってください。
          </li>
        </Ul>
      </Section>

      <Section title="4. 禁止事項">
        <Ul>
          <li>法令または公序良俗に反する行為</li>
          <li>他の利用者、第三者または運営者の権利を侵害する行為</li>
          <li>
            本サービスのサーバーやネットワークに過度な負荷をかける行為、AI機能の利用制限を不正に回避する行為（アカウントの大量作成を含む）
          </li>
          <li>本サービスを逆アセンブル・逆コンパイル等により解析する行為</li>
          <li>その他、運営者が不適切と判断する行為</li>
        </Ul>
        <p>
          禁止事項に該当する行為があった場合、運営者は事前の通知なくアカウントの停止または削除を行うことがあります。
        </p>
      </Section>

      <Section title="5. 知的財産権">
        <p>
          本サービスに関する著作権その他の知的財産権は運営者または正当な権利者に帰属します。利用者が本サービスに登録したデータの権利は利用者に帰属し、運営者は本サービスの提供に必要な範囲でのみこれを利用します。
        </p>
      </Section>

      <Section title="6. 料金">
        <p>
          本サービスは無料で利用できます。AI機能には利用回数の上限があります。将来的に有料プランを提供する場合は、事前に本サービス内でお知らせします。
        </p>
      </Section>

      <Section title="7. 免責">
        <Ul>
          <li>
            運営者は、本サービスの内容および利用によって生じた損害について、運営者に故意または重大な過失がある場合を除き、責任を負いません。
          </li>
          <li>
            通信環境、外部サービスの障害、メンテナンス等により本サービスを利用できない場合があります。
          </li>
          <li>
            運営者は、利用者のデータのバックアップ義務を負いません。重要なデータは利用者ご自身でも控えを保管してください。
          </li>
        </Ul>
      </Section>

      <Section title="8. サービスの終了">
        <p>
          運営者は、相当な予告期間をもって本サービスを終了することがあります。終了後、利用者のデータは削除されます。
        </p>
      </Section>

      <Section title="9. 本規約の変更">
        <p>
          運営者は、必要に応じて本規約を変更することがあります。変更後の規約は、本ページに掲載した時点から効力を生じます。
        </p>
      </Section>

      <Section title="10. 準拠法・管轄">
        <p>
          本規約は日本法に準拠します。本サービスに関して紛争が生じた場合、運営者の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
        </p>
      </Section>

      <Section title="11. お問い合わせ">
        <p>
          運営者：{LEGAL.operatorName}（{LEGAL.operatorType}）
          <br />
          メール：{LEGAL.contactEmail}
        </p>
      </Section>

      <div className="mt-5 border-t border-line pt-3">
        <Faint>
          制定日：{LEGAL.termsEnacted}／最終改定日：{LEGAL.termsUpdated}
        </Faint>
      </div>
    </article>
  );
}
