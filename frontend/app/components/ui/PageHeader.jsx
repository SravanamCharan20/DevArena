import React from "react";

const PageHeader = ({ eyebrow, title, description, aside }) => {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        {eyebrow ? <p className="chip">{eyebrow}</p> : null}
        <h1 className="section-title mt-3">{title}</h1>
        {description ? <p className="body-muted mt-2 text-sm sm:text-base">{description}</p> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </header>
  );
};

export default PageHeader;
