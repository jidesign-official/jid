"use client";

import { useState } from "react";
import {
  ContactFormData,
  createMailtoLink,
  formatContactContent,
  CONTACT_RECEIVER_EMAIL,
} from "@/app/actions/contact";

const projectTypes = ["Product", "UX/UI"];

const budgetRanges = [
  "1,000만원 미만",
  "1,000만원 - 3,000만원",
  "3,000만원 - 5,000만원",
  "5,000만원 이상",
];

export default function ContactForm() {
  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    company: "",
    message: "",
    selectedTypes: [],
    selectedBudget: "",
  });
  const [copyFeedback, setCopyFeedback] = useState("");

  const toggleProjectType = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedTypes: prev.selectedTypes.includes(type)
        ? prev.selectedTypes.filter((t) => t !== type)
        : [...prev.selectedTypes, type],
    }));
  };

  const handleCopyContent = async () => {
    try {
      await navigator.clipboard.writeText(formatContactContent(formData));
      setCopyFeedback("문의 내용이 클립보드에 복사되었습니다!");
    } catch {
      setCopyFeedback("복사하지 못했습니다. 작성한 내용을 직접 복사해 주세요.");
    }
  };

  return (
    <div className="w-full bg-white dark:bg-[#1C1C1E] rounded-[5px] p-6 md:p-10 shadow-sm border border-[#1D1D1F]/5 dark:border-white/10 transition-colors duration-300">
      <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
        프로젝트 문의하기
      </h3>
      <p className="text-sm text-[#1D1D1F]/60 dark:text-[#F5F5F7]/60 mb-8">
        어떤 프로젝트를 구상하고 계신가요? 아래 항목을 작성해 주시면 검토 후 답변드립니다.
      </p>

      <form action={`https://formsubmit.co/${CONTACT_RECEIVER_EMAIL}`} method="POST" className="space-y-8">
        <input type="hidden" name="_subject" value="[JiD 문의] 프로젝트 문의" />
        <input type="hidden" name="_template" value="table" />
        <input type="hidden" name="_captcha" value="true" />
        <input type="hidden" name="_next" value="https://jid.kr/contact/thanks/" />
        <input type="text" name="_honey" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <input type="hidden" name="selectedTypes" value={formData.selectedTypes.join(", ")} />
        <input type="hidden" name="selectedBudget" value={formData.selectedBudget} />

        <fieldset>
          <legend className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider mb-3">
            1. 관심 서비스 분야 (중복 선택 가능)
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {projectTypes.map((type) => {
              const isSelected = formData.selectedTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleProjectType(type)}
                  className={`px-4 py-2.5 rounded-[5px] text-xs md:text-sm font-medium transition-all duration-200 border flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? "bg-[#0066CC] text-white border-[#0066CC] shadow-md font-semibold ring-2 ring-[#0066CC]/30"
                      : "bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 hover:bg-white dark:hover:bg-[#1C1C1E] shadow-2xs"
                  }`}
                >
                  {isSelected && <span aria-hidden="true" className="text-xs font-bold">✓</span>}
                  <span>{type}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider mb-3">
            2. 예상 예산 범위
          </legend>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {budgetRanges.map((budget) => {
              const isSelected = formData.selectedBudget === budget;
              return (
                <button
                  key={budget}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setFormData({ ...formData, selectedBudget: budget })}
                  className={`px-3 py-3 rounded-[5px] text-xs md:text-sm font-medium transition-all duration-200 border text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? "bg-[#0066CC] text-white border-[#0066CC] shadow-md font-semibold ring-2 ring-[#0066CC]/30"
                      : "bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 hover:bg-white dark:hover:bg-[#1C1C1E] shadow-2xs"
                  }`}
                >
                  {isSelected && <span aria-hidden="true" className="text-xs font-bold">✓</span>}
                  <span>{budget}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label htmlFor="contact-name" className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider mb-2">
              성함 / 담당자명 *
            </label>
            <input
              id="contact-name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="홍길동"
              className="w-full px-4 py-3 rounded-[5px] bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] placeholder-[#1D1D1F]/40 dark:placeholder-white/40 text-sm border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 focus:outline-none focus:border-[#0066CC] focus:bg-white dark:focus:bg-[#1C1C1E] focus:ring-2 focus:ring-[#0066CC]/20 transition-all"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider mb-2">
              이메일 주소 *
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="name@company.com"
              className="w-full px-4 py-3 rounded-[5px] bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] placeholder-[#1D1D1F]/40 dark:placeholder-white/40 text-sm border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 focus:outline-none focus:border-[#0066CC] focus:bg-white dark:focus:bg-[#1C1C1E] focus:ring-2 focus:ring-[#0066CC]/20 transition-all"
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-company" className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider mb-2">
            회사명 / 브랜드명
          </label>
          <input
            id="contact-company"
            name="company"
            type="text"
            autoComplete="organization"
            value={formData.company}
            onChange={(e) => setFormData({ ...formData, company: e.target.value })}
            placeholder="JiD (선택사항)"
            className="w-full px-4 py-3 rounded-[5px] bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] placeholder-[#1D1D1F]/40 dark:placeholder-white/40 text-sm border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 focus:outline-none focus:border-[#0066CC] focus:bg-white dark:focus:bg-[#1C1C1E] focus:ring-2 focus:ring-[#0066CC]/20 transition-all"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label htmlFor="contact-message" className="block text-xs font-semibold text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 uppercase tracking-wider">
              프로젝트 설명 및 상세 요청사항 *
            </label>
            <span className="text-[11px] text-[#1D1D1F]/50 dark:text-[#F5F5F7]/50">{formData.message.length}자</span>
          </div>
          <textarea
            id="contact-message"
            name="message"
            required
            rows={5}
            maxLength={2000}
            value={formData.message}
            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
            placeholder="프로젝트의 목적, 주요 기능, 원하는 디자인 톤앤매너, 희망 일정 등을 자유롭게 작성해 주세요."
            className="w-full px-4 py-3.5 rounded-[5px] bg-[#F2F2F7] dark:bg-[#252528] text-[#1D1D1F] dark:text-[#F5F5F7] placeholder-[#1D1D1F]/40 dark:placeholder-white/40 text-sm leading-relaxed border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 hover:border-[#0066CC]/60 dark:hover:border-[#0066CC]/70 focus:outline-none focus:border-[#0066CC] focus:bg-white dark:focus:bg-[#1C1C1E] focus:ring-2 focus:ring-[#0066CC]/20 transition-all min-h-[140px] resize-y"
          />
        </div>

        <div className="space-y-3 text-xs leading-relaxed text-[#1D1D1F]/70 dark:text-[#F5F5F7]/70">
          <p id="contact-privacy">
            전송하면 외부 서비스 FormSubmit으로 이동하여 reCAPTCHA 확인을 진행합니다.
            성함, 이메일, 회사명, 문의 내용과 선택 항목은 이메일 전달을 위해 FormSubmit에 전송되며,
            서비스는 제출 내용을 30일간 보관합니다. 민감한 개인정보는 입력하지 마세요.{" "}
            <a href="https://formsubmit.co/privacy.pdf" target="_blank" rel="noopener noreferrer" className="text-[#0066CC] underline">FormSubmit 개인정보 처리방침 (새 창)</a>
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" name="consent" value="acknowledged" required aria-describedby="contact-privacy" className="mt-0.5 h-4 w-4 shrink-0 accent-[#0066CC]" />
            <span>FormSubmit으로의 개인정보 전송 및 30일 보관 안내를 확인하고 동의합니다. (필수)</span>
          </label>
        </div>

        <button type="submit" className="w-full py-4 rounded-[5px] bg-[#0066CC] hover:bg-[#0055B3] text-white font-medium text-base tracking-tight transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer">
          <span>이메일로 문의 보내기 ➔</span>
        </button>
      </form>

      <div className="mt-6 p-5 rounded-[5px] bg-[#F2F2F7] dark:bg-[#252528] text-xs text-[#1D1D1F]/80 dark:text-[#F5F5F7]/80 space-y-3">
        <p>외부 서비스 이용이 어렵다면 {CONTACT_RECEIVER_EMAIL}로 직접 문의해 주세요. 메일 앱에서는 직접 [보내기]를 눌러야 합니다.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <a href={createMailtoLink(formData)} className="flex-1 py-2.5 px-3 rounded-[5px] bg-white dark:bg-[#1C1C1E] border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 text-center hover:border-[#0066CC] transition-colors">메일 앱으로 직접 보내기</a>
          <button type="button" onClick={handleCopyContent} className="flex-1 py-2.5 px-3 rounded-[5px] bg-white dark:bg-[#1C1C1E] border border-[#1D1D1F]/15 dark:border-[#F5F5F7]/20 text-center hover:border-[#0066CC] transition-colors cursor-pointer">문의 내용 복사하기</button>
        </div>
        <p role="status" className="text-[#0066CC]">{copyFeedback}</p>
      </div>
    </div>
  );
}
